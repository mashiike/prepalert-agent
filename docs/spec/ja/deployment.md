# デプロイガイド

## API プロバイダ

prepalert-agent は [Claude Agent SDK](https://github.com/anthropics/claude-agent-sdk-typescript) を使用しており、以下の API プロバイダに対応している。

| プロバイダ | 説明 |
|---|---|
| Anthropic API (直接) | `ANTHROPIC_API_KEY` で認証 |
| Amazon Bedrock | AWS 認証情報（IAM ロール / アクセスキー）で認証 |
| Google Vertex AI | Google Cloud ADC (Application Default Credentials) で認証 |

各プロバイダの設定方法（環境変数、認証、モデル名の指定）は Claude Agent SDK および Claude Code の公式ドキュメントを参照すること。

- [Claude Agent SDK](https://github.com/anthropics/claude-agent-sdk-typescript)
- [Claude Code - API プロバイダ設定](https://docs.anthropic.com/en/docs/claude-code)

prepalert-agent は SDK の設定をそのまま継承するため、Claude Code で動作するプロバイダ設定であればそのまま使える。

## コンテナイメージ

公式コンテナイメージは ghcr.io で提供している。

```bash
docker pull ghcr.io/mashiike/prepalert-agent:latest
docker pull ghcr.io/mashiike/prepalert-agent:0.1.0
```

- ベースイメージ: `node:26-slim`
- アーキテクチャ: `linux/amd64`, `linux/arm64`
- Python ツール用に `uv` / `uvx` を同梱

### カスタムイメージ

MCP サーバーの依存（Python パッケージ等）を追加する場合:

```dockerfile
FROM ghcr.io/mashiike/prepalert-agent:latest

RUN uvx install awscli
# または
RUN pip install some-mcp-server
```

## デプロイ構成例

### ECS Fargate

最もシンプルな構成。非同期モード + ECS タスク保護により、Agent 実行中のタスク終了を防止する。

```
[Mackerel] --webhook--> [ALB] --> [ECS Fargate]
                                    prepalert-agent serve
```

**prepalert.yaml:**

```yaml
name: my-monitoring
model: sonnet
timeout: 15m

serve:
  webhooks:
    - path: /webhook/mackerel
      authType: basic
      username: ${WEBHOOK_USER}
      password: ${WEBHOOK_PASS}
```

**必要な IAM 権限:**

- タスクロール: `ecs:UpdateTaskProtection`（タスク保護に必要）
- API プロバイダの認証情報（Bedrock の場合: `bedrock:InvokeModel`）

**ポイント:**

- `ecsTaskProtection: auto`（デフォルト）により、`ECS_AGENT_URI` が検出されると自動でタスク保護を有効化
- 非同期モード（デフォルト）なので ALB のアイドルタイムアウトを気にしなくてよい
- `timeout` を ECS タスクの停止猶予時間（`stopTimeout`）より短く設定すること

### Cloud Run + Cloud Tasks

Cloud Run の最大リクエストタイムアウト（60分）を超える可能性がある場合や、アラートソース側のタイムアウトが短い場合に適する。

```
[Mackerel] --webhook--> [Cloud Run] --enqueue--> [Cloud Tasks]
                              ^                        |
                              |      callback          |
                              +------------------------+
```

**二段 endpoint パターン:**

```yaml
name: my-monitoring
model: sonnet
timeout: 15m

serve:
  webhooks:
    - path: /webhook/mackerel
      authType: basic
      username: ${WEBHOOK_USER}
      password: ${WEBHOOK_PASS}
      dispatch:
        type: cloud-tasks
        queue: ${CLOUD_TASKS_QUEUE}
        targetPath: /internal/process
        oidc:
          audience: ${CLOUD_RUN_URL}
    - path: /internal/process
      authType: oidc
      issuer: https://accounts.google.com
      audience: ${CLOUD_RUN_URL}
      sync: true
```

**単一 path パターン:**

```yaml
serve:
  webhooks:
    - path: /webhook/mackerel
      authType: oidc
      issuer: https://accounts.google.com
      audience: ${CLOUD_RUN_URL}
      sync: true
      dispatch:
        type: cloud-tasks
        queue: ${CLOUD_TASKS_QUEUE}
```

**必要な IAM 権限:**

- Cloud Run サービスアカウント: `cloudtasks.tasks.create`
- Cloud Tasks サービスアカウント: `run.routes.invoke`（コールバック用）
- API プロバイダの認証情報（Vertex AI の場合: `aiplatform.endpoints.predict`）

**ポイント:**

- `dispatch.dispatchDeadline` を設定すること（未設定だと Cloud Tasks のデフォルト10分で短すぎる可能性がある）
- Cloud Run の最大同時リクエスト数を 1 に設定すると、Agent 実行のリソース競合を防げる
- 二段パターンでは受信用は basic 認証、処理用は OIDC 認証と使い分けられる

### Lambda + API Gateway + SQS

Lambda のコールドスタートと最大実行時間（15分）の制約がある。短時間で完了する調査に適する。

```
[Mackerel] --webhook--> [API Gateway] --> [Lambda]
                                            |
                                            v (長時間の場合)
                                          [SQS] --> [Lambda]
```

**prepalert.yaml:**

```yaml
name: my-monitoring
model: sonnet
timeout: 14m

serve:
  webhooks:
    - path: /webhook/mackerel
      authType: basic
      username: ${WEBHOOK_USER}
      password: ${WEBHOOK_PASS}
      dispatch:
        type: aws-sqs
        queueUrl: ${SQS_QUEUE_URL}
        targetPath: /internal/process
    - path: /internal/process
      authType: none
      sync: true
```

**ポイント:**

- Lambda の最大実行時間は 15 分。`timeout` はそれより短く設定すること
- **`sessionsDir` は Lambda 環境では自動的に `/tmp` 配下（`/tmp/prepalert-sessions`）にフォールバックする。** Lambda のファイルシステムは `/tmp` 以外が読み取り専用で、`sessionsDir`（デフォルト `<project-dir>/sessions`）はローカルバッファとして常に書き込まれるため。`/tmp` 配下以外が設定されている場合は warn ログを出してフォールバックする。warn を消すには `sessionsDir` を明示的に `/tmp` 配下に設定すること。`storage`（S3）を設定していても `sessionsDir` への書き込みは発生する点に注意
- `compile:lambda` スクリプト（`bun build --compile --target=bun-linux-x64 --outfile bootstrap`）で Lambda カスタムランタイム用バイナリをビルドできる
- SQS の `VisibilityTimeout` を `timeout` 以上に設定すること
- Lambda 環境では非同期モードが強制的に同期モードに切り替わる（Lambda は fire-and-forget を許容しないため）
- API Gateway v2 (HTTP API) を使用すること（SQS dispatch は v2 イベント形式で送信する）
- Lambda のイベントソースマッピングで **`ReportBatchItemFailures`** を有効にすること。prepalert-agent は SQS バッチ処理で失敗したレコードのみ `batchItemFailures` として返す（partial batch response）。この設定がないと、1件の失敗でバッチ全体が再配信され二重実行になる

### Bedrock AgentCore Runtime

AgentCore Runtime は microVM 上でエージェントを実行する。`GET /ping` によるヘルスチェックと `POST /invocations` によるリクエスト受付が必要。

```
[AgentCore Runtime] --> [microVM]
                          prepalert-agent serve
```

**prepalert.yaml:**

```yaml
name: my-monitoring
model: sonnet
timeout: 15m

serve:
  healthCheck:
    path: /ping
    idle:
      body: '{"status":"Healthy","time_of_last_update":@unix_time}'
    busy:
      body: '{"status":"HealthyBusy","time_of_last_update":@unix_time}'
  webhooks:
    - path: /invocations
      authType: none
      sync: true
```

**ポイント:**

- `HealthyBusy` を返している間は microVM の自動終了が抑制される
- `@unix_time` は動的に展開されるため、常に最新のタイムスタンプが返る
- `authType: none` で問題ない（AgentCore Runtime 内のネットワークは閉じている）
- API プロバイダは AgentCore Runtime が自動設定する

## SPA と OIDC 認証

`serve` コマンドはセッションビューアー SPA を組み込んでいる。外部公開する場合は OIDC 認証を設定すること。

**`serve.auth` を設定しない場合、SPA と `/api/*` は無認証で応答する。** この構成は、CloudFront や ALB 等の上流でアクセスを遮断・認証しているか、信頼できるネットワーク内でのみ到達可能であることを前提とする。この前提を満たさずにインターネットへ公開すると、セッション（アラート調査結果・ログ・アーティファクト）が誰でも閲覧可能になる。

```yaml
serve:
  baseUrl: https://prepalert.example.com
  sessionSecret: ${SESSION_SECRET}
  exportSecret: ${EXPORT_SECRET}
  auth:
    issuer: https://accounts.google.com
    clientId: ${GOOGLE_CLIENT_ID}
    clientSecret: ${GOOGLE_CLIENT_SECRET}
    allowedDomains:
      - example.com
```

- `baseUrl` は OAuth コールバック URL の構築に使われる。リバースプロキシ環境では明示設定を推奨
- `sessionSecret` / `exportSecret` を設定しないと、サーバー再起動時にセッションと export URL が無効化される
- webhook パスには OIDC セッション認証は適用されない（webhook 固有の `authType` で制御）

詳細は [auth.md](./auth.md) を参照。

## 永続ストレージ

セッションデータをサーバー再起動後も保持するには `storage` を設定する。

```yaml
storage: s3://my-bucket/prepalert/
storageOptions:
  region: ap-northeast-1
```

- S3 または GCS（`s3://` / `gs://`）に対応
- S3 互換ストレージ（MinIO 等）は `storageOptions.endpoint` と `forcePathStyle` で対応
- **GCS（`gs://`）は S3 互換 XML API + SigV4 でアクセスするため、GCS の interoperability HMAC キーを `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` として渡す必要がある**（GCP ネイティブ認証では動作しない）。詳細は [project-config.md](./project-config.md) の `storage` を参照
- `sessionsDir` はローカルバッファとして常に使用される。`storage` はそこからの非同期アップロード先

詳細は [project-config.md](./project-config.md) の `storage` / `storageOptions` を参照。
