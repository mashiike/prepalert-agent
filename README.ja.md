# prepalert-agent

[English](README.md)

アラート発火時にログや関連情報を自動収集する CLI ツール。[Claude Agent SDK](https://github.com/anthropics/claude-agent-sdk-typescript) で動作します。

既存の [prepalert](https://github.com/mashiike/prepalert)（Go, HCL ベース）の発展形です。宣言的な HCL クエリの代わりに、AI エージェントがアラート内容に応じて柔軟に情報収集を行います。

## インストール

[GitHub Releases](https://github.com/mashiike/prepalert-agent/releases) からバイナリをダウンロード。

またはソースからビルド:

```bash
bun install
bun run compile
```

Docker イメージも利用可能:

```bash
docker pull ghcr.io/mashiike/prepalert-agent
```

## 使い方

```
Usage: prepalert-agent [options] [command]

Alert response agent powered by Claude Agent SDK

Options:
  -v, --version        バージョン表示
  --project-dir <dir>  プロジェクトディレクトリのパス (default: ".")
  --log-level <level>  ログレベル (debug|info|warn|error, default: "info")
  -h, --help           ヘルプ表示

Commands:
  run [options]        アラート対応を実行（対話 or ヘッドレス）
  serve [options]      Webhook サーバーを起動
  init                 新しいアラート対応プロジェクトを初期化
  skills               スキル管理（list/install/update/uninstall/status）
  docs                 ドキュメント表示
  help [command]       コマンドのヘルプ表示
```

### `run`

アラートに対して runbook を実行します。エージェントがアラートペイロードを分析し、適切な runbook を選択して MCP ツールで調査します。

```bash
# 対話モード
prepalert-agent run

# ヘッドレスモード（プロンプト指定）
prepalert-agent run -p "5xx エラーレートが閾値を超えたアラートを調査してください"

# アラートファイルを入力として渡す
cat alerts/web-api-5xx.json | prepalert-agent run -p -
```

### `serve`

Webhook サーバーを起動し、アラート通知を受信して runbook を実行します。

```bash
prepalert-agent serve
prepalert-agent serve --port 9090
```

機能:
- **認証**: webhook ごとに None / Basic / OIDC (JWT) を設定可能
- **SPA**: セッションビューアー（レポート、アーティファクト、トランスクリプト閲覧）
- **OIDC 認証**: SPA + API に Google / Auth0 等の OIDC 認証をかけられる
- **非同期モード**（デフォルト）: 即座に 202 を返し、バックグラウンドで実行
- **同期モード**: 完了まで待って 200 を返す（Cloud Run 等）
- **ECS タスク保護**: 非同期処理中のタスク終了を自動防止
- **外部キュー連携**: Cloud Tasks / AWS SQS へのディスパッチ

### `init`

新しいアラート対応プロジェクトのスキャフォールディング。

```bash
prepalert-agent init
```

## プロジェクト構成

```
my-project/
├── prepalert.yaml          # プロジェクト設定 + エージェント指示
├── .mcp.json               # MCP サーバー定義（Claude Code と同フォーマット）
├── references/             # エージェント参照用の静的ドキュメント
│   └── service-map.md
├── runbooks/               # 調査手順書
│   └── web-api/
│       └── 5xx-rate-over-limit.md
├── logs/                   # 運用ログ（自動生成、.gitignore 推奨）
└── sessions/               # セッション記録（自動生成、.gitignore 推奨）
    └── YYYY/MM/DD/{session-id}/
        ├── metadata.json
        ├── transcript.jsonl
        ├── report.md
        └── artifacts/
```

### `prepalert.yaml`

文字列値は bash 互換の環境変数展開をサポート:

| 構文 | 動作 |
|---|---|
| `${VAR}` | 値を展開。未設定の場合はエラー |
| `${VAR:-default}` | 未設定または空文字列の場合に `default` を使用 |
| `${VAR-default}` | 未設定の場合に `default` を使用 |
| `${VAR:+alt}` | 設定済みかつ非空の場合に `alt` を使用 |
| `${VAR:?message}` | 未設定または空文字列の場合にエラー |

```yaml
name: my-web-api-monitoring
model: sonnet
maxTurns: 10
costLimit: 1.0
timeout: 15m

instructions: |
  このプロジェクトは ECS 上で動く Web API を監視しています。
  調査結果は日本語でまとめてください。

serve:
  auth:
    issuer: https://accounts.google.com
    clientId: ${GOOGLE_CLIENT_ID}
    clientSecret: ${GOOGLE_CLIENT_SECRET}
    allowedDomains:
      - example.com
  webhooks:
    - path: /webhook/mackerel
      authType: basic
      username: ${MACKEREL_WEBHOOK_USER}
      password: ${MACKEREL_WEBHOOK_PASS}
      headerPrompt: "Mackerel アラートを受信しました:"
```

詳細は [docs/spec/ja/project-config.md](docs/spec/ja/project-config.md) を参照。

### Runbook

Runbook は YAML frontmatter 付きの Markdown ファイルです。エージェントがアラート内容に基づいて選択・実行します。

```markdown
---
description: CloudWatch Logs を使って 5xx エラーを調査する
trigger: 5xx エラーレートが閾値を超えたとき
---

1. Mackerel でアラート詳細を確認し、対象サービスを特定
2. aws-mcp で CloudWatch Logs を確認
3. エラーパターンを分類し、影響範囲を特定
```

Runbook ID はファイルパスから導出: `runbooks/web-api/5xx-rate-over-limit.md` → `web-api/5xx-rate-over-limit`

詳細は [docs/spec/ja/runbook.md](docs/spec/ja/runbook.md) を参照。

## Observability (OpenTelemetry)

prepalert-agent は OpenTelemetry (OTLP/HTTP) によるログ・メトリクス・トレースのエクスポートをサポートしています。

### 有効化

標準の OTel 環境変数を設定するだけで有効になります:

```bash
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
prepalert-agent run -p "アラートを調査してください"
```

`OTEL_EXPORTER_OTLP_ENDPOINT` 未設定時はテレメトリは完全に無効（オーバーヘッドゼロ）。

### エクスポート内容

**トレース** — セッション単位の階層的スパン:

```
session (session.id, session.cost_usd)
├── turn-1 (turn.number, turn.cost_usd, turn.input_tokens, turn.output_tokens)
│   ├── tool/Bash (tool.id, tool.name)
│   └── tool/Read (tool.id, tool.name)
└── turn-2
    └── tool/Agent (tool.id, tool.name)
```

**メトリクス:**

| 名前 | 型 | 説明 |
|---|---|---|
| `prepalert.session.cost_usd` | Histogram | セッションあたりの総コスト (USD) |
| `prepalert.session.turns` | Counter | 総ターン数 |
| `prepalert.session.input_tokens` | Counter | 総入力トークン数 |
| `prepalert.session.output_tokens` | Counter | 総出力トークン数 |

**ログ** — 構造化ログ（ローカル JSONL と同内容）が OTLP 経由で転送。

詳細は [docs/spec/ja/telemetry.md](docs/spec/ja/telemetry.md) を参照。

## 仕様ドキュメント

| ドキュメント | 内容 |
|---|---|
| [project-config.md](docs/spec/ja/project-config.md) | プロジェクト設定の全フィールド |
| [runbook.md](docs/spec/ja/runbook.md) | Runbook の書き方 |
| [auth.md](docs/spec/ja/auth.md) | OIDC 認証の設定 |
| [export-and-handoff.md](docs/spec/ja/export-and-handoff.md) | セッションのエクスポートとハンドオフ |
| [project-structure.md](docs/spec/ja/project-structure.md) | プロジェクト構成の詳細 |
| [telemetry.md](docs/spec/ja/telemetry.md) | OpenTelemetry の詳細 |
| [init.md](docs/spec/ja/init.md) | init コマンドの仕様 |
| [install-skills.md](docs/spec/ja/install-skills.md) | skills コマンドの仕様 |

## 開発

### 前提条件

- [Bun](https://bun.sh/) >= 1.3
- [Node.js](https://nodejs.org/) >= 26（[asdf](https://asdf-vm.com/) で管理）

### セットアップ

```bash
asdf install
bun install
```

### コマンド

```bash
bun run dev          # 開発時の実行
bun run build        # TypeScript コンパイル
bun run compile      # ワンバイナリビルド
bun test             # テスト実行
```

## ライセンス

MIT License. 詳細は [LICENSE](LICENSE) を参照。
