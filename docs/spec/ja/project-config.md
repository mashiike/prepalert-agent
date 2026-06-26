# プロジェクト設定 (`prepalert.yaml`)

プロジェクトルートに配置する設定ファイル。Agent の動作全般を制御する。

### 環境変数展開

文字列値内の `${VAR_NAME}` は環境変数で展開される。bash 互換の変数展開構文をサポートする。

| 構文 | 動作 |
|---|---|
| `${VAR}` | 値を展開。未設定の場合はエラー |
| `${VAR:-default}` | 未設定または空文字列の場合に `default` を使用 |
| `${VAR-default}` | 未設定の場合に `default` を使用（空文字列はそのまま展開） |
| `${VAR:+alternate}` | 設定済みかつ非空の場合に `alternate` を使用、それ以外は空文字列 |
| `${VAR+alternate}` | 設定済みの場合に `alternate` を使用、未設定の場合は空文字列 |
| `${VAR:?message}` | 未設定または空文字列の場合にエラー（カスタムメッセージ指定可） |
| `${VAR?message}` | 未設定の場合にエラー（空文字列は許容） |

`:` 付きの構文は「未設定 **または** 空文字列」を対象とし、`:` なしは「未設定のみ」を対象とする。

```yaml
# 例
serve:
  webhooks:
    - path: /webhook
      username: ${WEBHOOK_USER}
      password: ${WEBHOOK_PASS}
      headerPrompt: ${HEADER_PROMPT:-The following alert has been received:}
```

環境変数展開は設定読み込み時に **静的に** 1回だけ行われる。リクエストごとに値が変わる動的な展開は行われない。

## ファイル構造

```yaml
name: <string>                        # プロジェクト名 (required)
model: <string>                       # Agent が使用するモデル (optional)
effort: <string>                      # Agent の推論努力レベル (optional)
runbooksDir: <string>                 # runbook ディレクトリのパス (optional, default: "runbooks")
logsDir: <string>                     # 運用ログ保存ディレクトリ (optional, default: "logs")
sessionsDir: <string>                 # セッション記録保存ディレクトリ (optional, default: "sessions")
storage: <string>                     # 永続ストレージ URL (optional, e.g. "s3://bucket/prefix/", "gs://bucket/prefix/")
storageOptions:                       # S3 互換ストレージ用オプション (optional)
  endpoint: <string>                  # カスタムエンドポイント (MinIO, さくら等)
  forcePathStyle: <boolean>           # パススタイルアクセス (MinIO 等で必要)
  region: <string>                    # リージョン
maxTurns: <number>                    # Agent の最大ターン数 (optional, default: 10)
costLimit: <number>                   # 1回の実行あたりのコスト上限 USD (optional)
timeout: <string>                     # 実行タイムアウト (optional, e.g. "15m", "1h")
mcpConfig: <string>                   # .mcp.json のパス (optional, default: ".mcp.json")
allowedTools: <string[]>              # 許可するツール (optional)
disallowedTools: <string[]>           # 禁止するツール (optional)
settingSources: <string[]>            # SDK 設定読み込みソース (optional, default: ["project", "local"])

instructions: |                       # Agent への共通指示 (optional, instructionsFile と排他)
  自由形式のテキスト。
instructionsFile: <string>            # instructions を外部ファイルから読み込む (optional, instructions と排他)

serve:                                # serve コマンド設定 (optional)
  port: <number>                      # ポート番号 (optional, default: 8080)
  syncMode: <boolean>                 # webhook のデフォルト同期モード (optional, default: false)
  ecsTaskProtection: <string>         # webhook のデフォルト ECS タスク保護 (optional, "auto" | "off", default: "auto")
  exportSecret: <string>              # export URL の JWT 署名鍵 (optional, 未設定時は自動生成)
  sessionSecret: <string>             # session cookie の JWT 署名鍵 (optional, auth 使用時は推奨)
  baseUrl: <string>                   # 外部公開 URL (optional, 未設定時はリクエストヘッダから推定)
  staticDir: <string>                 # フロントエンドの静的ファイルディレクトリ (optional, 未設定時は組み込み SPA)
  auth:                               # OIDC 認証設定 (optional, 設定すると SPA + API に認証がかかる)
    issuer: <string>                  # OIDC issuer URL (required)
    clientId: <string>                # OAuth クライアント ID (required)
    clientSecret: <string>            # OAuth クライアントシークレット (required)
    allowedDomains: <string[]>        # 許可メールドメイン (optional, 未設定時は全ユーザー許可)
  healthCheck:                        # ヘルスチェック設定 (optional)
    path: <string>                    # エンドポイントパス (optional, default: "/health")
    contentType: <string>             # Content-Type ヘッダー (optional, default: "application/json")
    idle:                             # activeRequests == 0 のとき (optional)
      status: <number>                # HTTP ステータスコード (optional, default: 200)
      body: <string | { sh: string }> # レスポンスボディ (optional, 動的変数展開対応)
    busy:                             # activeRequests > 0 のとき (optional)
      status: <number>                # HTTP ステータスコード (optional, default: 200)
      body: <string | { sh: string }> # レスポンスボディ (optional, 動的変数展開対応)
  webhooks:                           # webhook エンドポイント (optional)
    - path: <string>
      authType: <string>              # "none" | "basic" | "oidc"
      headerPrompt: <string>          # webhook 受信時の prompt ヘッダー (optional)
      sync: <boolean>                 # 同期モード (optional, default: serve.syncMode)
      ecsTaskProtection: <string>     # ECS タスク保護 (optional, default: serve.ecsTaskProtection)
      username: <string>              # basic 用
      password: <string>              # basic 用
      issuer: <string>                # oidc 用
      audience: <string>              # oidc 用
      jwksUri: <string>               # oidc 用 (optional)
      dispatch:                       # 外部キューへの転送設定 (optional)
        type: <string>                # "cloud-tasks" (discriminated union)
        queue: <string>               # Cloud Tasks キューリソース名 (required)
        targetPath: <string>          # 転送先パス (optional, 省略 = 自分に戻す)
        baseUrl: <string>             # タスク送信先のベース URL (optional, request Host から構築)
        dispatchDeadline: <string>    # タスク実行期限 (optional, default: project timeout)
        oidc:                         # Cloud Tasks → target の OIDC 認証 (optional)
          serviceAccountEmail: <string>  # optional, メタデータサーバーから取得
          audience: <string>          # optional, default: baseUrl
```

## フィールド

### `name`

- **型:** `string`
- **必須:** Yes
- **説明:** プロジェクト名。ログ出力や識別に使用する。

### `model`

- **型:** `string`
- **必須:** No
- **デフォルト:** Agent SDK のデフォルトモデル
- **説明:** Agent が使用する Claude のモデル名。`sonnet`, `opus`, `haiku` 等。runbook 側で上書き可能。

### `effort`

- **型:** `"low"` | `"medium"` | `"high"` | `"xhigh"` | `"max"`
- **必須:** No
- **デフォルト:** Agent SDK のデフォルト
- **説明:** Agent の推論努力レベル。同じモデルでも「浅く速く」と「深くじっくり」を使い分けられる。runbook 側で上書き可能。

### `runbooksDir`

- **型:** `string`
- **必須:** No
- **デフォルト:** `"runbooks"`
- **説明:** runbook ファイルを格納するディレクトリのパス。プロジェクトルートからの相対パス。

### `logsDir`

- **型:** `string`
- **必須:** No
- **デフォルト:** `"logs"`
- **説明:** 運用ログを保存するディレクトリのパス。プロジェクトルートからの相対パス。JSON Lines 形式でプロセスごとに1ファイル作成される。`.gitignore` に追加することを推奨。

### `sessionsDir`

- **型:** `string`
- **必須:** No
- **デフォルト:** `"sessions"`
- **説明:** Agent 実行セッションの記録を保存するローカルディレクトリのパス。プロジェクトルートからの相対パス。日付パーティション構造（`YYYY/MM/DD/{session-id}/`）で保存される。`.gitignore` に追加することを推奨。`storage` が設定されていても、常にここに書き込まれる（ローカルバッファ）。

### `storage`

- **型:** `string`
- **必須:** No
- **デフォルト:** なし（未設定時は `sessionsDir` がそのまま永続先）
- **説明:** 永続ストレージの URL。`s3://bucket/prefix/` または `gs://bucket/prefix/` 形式。設定すると、セッションデータ（report, artifact, metadata）が即時書き込まれ、transcript はセッション完了時にアップロードされる。API はこちらから読み取る。

### `storageOptions`

- **型:** `object`
- **必須:** No
- **説明:** S3 互換ストレージ用のオプション。MinIO、さくらストレージ等で使用。

| フィールド | 型 | 説明 |
|---|---|---|
| `endpoint` | `string` | カスタムエンドポイント URL |
| `forcePathStyle` | `boolean` | パススタイルアクセスを使用（MinIO 等で必要） |
| `region` | `string` | リージョン |

### `maxTurns`

- **型:** `number`
- **必須:** No
- **デフォルト:** `10`
- **説明:** Agent の最大ターン数。ツール呼び出しとレスポンスのやり取り回数の上限。runbook 側で上書き可能。

### `costLimit`

- **型:** `number`
- **必須:** No
- **説明:** 1回の実行あたりのコスト上限（USD）。この金額に達すると Agent は実行を停止する。runbook 側で上書き可能。

### `timeout`

- **型:** `string`
- **必須:** No
- **説明:** 1回の実行あたりのタイムアウト。`30s`, `15m`, `1h` のような duration 形式で指定する。タイムアウトに達すると Agent は中断される。ヘッドレスモード（`-p` / `serve`）でのみ適用。対話モードではユーザーがセッション寿命を制御する。

### `mcpConfig`

- **型:** `string`
- **必須:** No
- **デフォルト:** `".mcp.json"`
- **説明:** MCP サーバー設定ファイルのパス。プロジェクトルートからの相対パス。Claude Code の `.mcp.json` を共有したい場合に、そのパスを指定する。例: `mcpConfig: "../.mcp.json"`

### `allowedTools`

- **型:** `string[]`
- **必須:** No
- **デフォルト:** ヘッドレス時は `["Read", "Glob", "Grep", "WebSearch", "WebFetch", "Agent"]` + MCP 全サーバーのワイルドカード（`mcp__<server>__*`）。対話モードでは未設定（permission mode に従う）
- **説明:** 許可プロンプトなしで自動承認されるツールのリスト。glob パターン対応。例: `["mcp__mackerel__*", "Read"]`。ヘッドレス時は `dontAsk` モードと組み合わせて使用され、ここに列挙されたツールのみが実行可能になる。
- **注意:** これは親 Agent の permission 設定。runbook サブエージェントの `allowedTools`（AgentDefinition の `tools`）はサブエージェントが使えるツールの可視性制限であり、permission の auto-approve は親の設定が適用される。詳細は「permission とサブエージェントの関係」を参照。

### `disallowedTools`

- **型:** `string[]`
- **必須:** No
- **説明:** 禁止するツールのリスト。`allowedTools` より優先される。`bypassPermissions` モードでも適用される。スコープ付きパターン（例: `Bash(rm *)`)も使用可能。例: `["Bash(rm *)", "Edit"]`。

### `settingSources`

- **型:** `string[]`
- **必須:** No
- **デフォルト:** `["project", "local"]`
- **説明:** Claude Agent SDK が設定を読み込むソース。`"user"`（`~/.claude/settings.json`）、`"project"`（`.claude/settings.json`）、`"local"`（`.claude/settings.local.json`）が指定可能。デフォルトでは `user` を含まないため、ユーザー個人の Claude Code 設定（MCP サーバー等）は読み込まれない。組織の Claude Code 設定を継承したい場合は `["user", "project", "local"]` を指定する。

### `instructions`

- **型:** `string` (YAML block scalar)
- **必須:** No
- **説明:** 全 runbook 実行時に共通で Agent の system prompt に含まれる指示テキスト。`instructionsFile` と同時に設定するとエラー。

### `instructionsFile`

- **型:** `string`
- **必須:** No
- **説明:** Agent への共通指示を外部ファイルから読み込む。プロジェクトルートからの相対パス。`instructions` と同時に設定するとエラー。例: `instructionsFile: PREPALERT.md`

### `serve`

`serve` コマンド固有の設定。

#### `serve.port`

- **型:** `number`
- **必須:** No
- **デフォルト:** `8080`
- **説明:** `serve` コマンドで使用するポート番号。`--port` CLI オプションでオーバーライド可能。

#### `serve.syncMode`

- **型:** `boolean`
- **必須:** No
- **デフォルト:** `false`
- **説明:** 各 webhook の `sync` フィールドのデフォルト値。webhook 側で個別に上書き可能。`true` の場合、webhook ハンドラは Agent の実行完了まで待ってから 200 OK を返す。`false` の場合は即座に 202 Accepted を返し、Agent はバックグラウンドで実行する。

#### `serve.ecsTaskProtection`

- **型:** `"auto"` | `"off"`
- **必須:** No
- **デフォルト:** `"auto"`
- **説明:** 各 webhook の `ecsTaskProtection` フィールドのデフォルト値。webhook 側で個別に上書き可能。`auto` の場合、非同期モード（`sync: false`）かつ `ECS_AGENT_URI` 環境変数が存在する場合に、webhook 処理中のタスク保護を自動で有効化する。`sync: true` の場合はこの設定に関わらず保護は行われない。タスクロールに `ecs:UpdateTaskProtection` 権限が必要。

#### `serve.exportSecret`

- **型:** `string`
- **必須:** No
- **説明:** export URL の JWT 署名に使う秘密鍵。未設定時はサーバー起動時にランダム生成される（再起動で既存の export URL が無効になる）。本番環境では環境変数経由で設定すること。

#### `serve.sessionSecret`

- **型:** `string`
- **必須:** No（`auth` 使用時は推奨）
- **説明:** session cookie の JWT 署名鍵。`exportSecret` とは分離されている。未設定時はランダム生成される（再起動で全ユーザーが再ログインになる）。

#### `serve.baseUrl`

- **型:** `string`
- **必須:** No
- **説明:** 外部公開 URL（例: `https://prepalert.example.com`）。export URL や OAuth redirect URI の構築に使われる。未設定時はリクエストヘッダ（`X-Forwarded-Host` 等）から自動推定。本番環境では明示設定を推奨。

#### `serve.staticDir`

- **型:** `string`
- **必須:** No
- **説明:** フロントエンドの静的ファイルディレクトリ。プロジェクトルートからの相対パス。未設定時は組み込みの SPA を使用。カスタムフロントエンドを使う場合にビルド成果物のディレクトリを指定する。

#### `serve.auth`

OIDC 認証設定。設定すると SPA（`/`, `/sessions/*`）と API（`/api/*`）に認証がかかる。未設定時は認証なし。
詳細は [auth.md](./auth.md) を参照。

| フィールド | 型 | 必須 | 説明 |
|---|---|---|---|
| `issuer` | `string` | Yes | OIDC issuer URL |
| `clientId` | `string` | Yes | OAuth クライアント ID |
| `clientSecret` | `string` | Yes | OAuth クライアントシークレット |
| `allowedDomains` | `string[]` | No | 許可するメールドメイン。未設定時は全ユーザー許可 |

#### `serve.healthCheck`

ヘルスチェックエンドポイントの設定。`serve` コマンド起動時に自動で有効になる。認証は適用されない（常に公開）。

未設定の場合、以下のデフォルト動作になる:

- **パス:** `GET /health`
- **idle 時:** `200 {"status":"idle","activeRequests":0}`
- **busy 時:** `200 {"status":"busy","activeRequests":<N>}`

#### `serve.healthCheck.path`

- **型:** `string`
- **必須:** No
- **デフォルト:** `"/health"`
- **説明:** ヘルスチェックエンドポイントのパス。`GET` メソッドで応答する。webhook の path と重複した場合はエラー。`/`、`/index.html`、`/api/` で始まるパスは予約されており使用不可。

#### `serve.healthCheck.contentType`

- **型:** `string`
- **必須:** No
- **デフォルト:** `"application/json"`
- **説明:** レスポンスの `Content-Type` ヘッダー。

#### `serve.healthCheck.idle`

`activeRequests == 0`（処理中のリクエストがない）ときのレスポンス設定。

#### `serve.healthCheck.idle.status`

- **型:** `number`
- **必須:** No
- **デフォルト:** `200`
- **説明:** HTTP ステータスコード。

#### `serve.healthCheck.idle.body`

- **型:** `string` | `{ sh: string }`
- **必須:** No
- **デフォルト:** `'{"status":"idle","activeRequests":0}'`
- **説明:** レスポンスボディ。文字列指定と `sh:` によるコマンド実行の2形式をサポートする。

**文字列指定:** 文字列内の `@変数名` がリクエスト処理時に動的に展開される。

| 変数 | 型 | 説明 |
|---|---|---|
| `@unix_time` | number | 現在時刻（Unix epoch 秒） |
| `@active_requests` | number | 処理中のリクエスト数 |
| `@total_requests` | number | サーバー起動後の累計リクエスト数 |
| `@uptime` | number | サーバー起動からの経過秒数 |

環境変数展開（`${VAR}`）は読み込み時に静的に処理され、動的変数展開（`@var`）はリクエスト処理時に後から処理される。両者は同じ文字列内で併用可能。

**`sh:` 指定:** 評価のたびにシェルコマンドを実行し、標準出力（末尾改行は除去）をボディとして使用する。`sh:` 指定時は動的変数展開（`@var`）は適用されない。環境変数展開（`${VAR}`）は読み込み時にコマンド文字列自体に適用される。ヘルスチェックは頻繁に呼ばれるため、パフォーマンスに注意すること。

**セキュリティに関する注意:** `sh:` は `prepalert.yaml` に書かれた文字列をシェルで直接実行する（任意コマンド実行）。コマンドの標準出力はヘルスチェックの HTTP レスポンスボディとしてそのまま返される。ヘルスチェックエンドポイントは認証なし（`serve.auth` 設定時も認証が適用されない）で外部公開されるため、機密情報を出力するコマンドは使用しないこと。`prepalert.yaml` は信頼された設定ファイルである前提で設計されている。環境変数展開（`${VAR}`）はコマンド文字列に静的に埋め込まれるため、環境変数に悪意ある値が入るとシェルインジェクションの余地がある。`sh:` で環境変数を使用する場合は、信頼できる値のみを設定すること。

#### `serve.healthCheck.busy`

`activeRequests > 0`（処理中のリクエストがある）ときのレスポンス設定。フィールド構成は `idle` と同一。

#### `serve.healthCheck.busy.status`

- **型:** `number`
- **必須:** No
- **デフォルト:** `200`
- **説明:** HTTP ステータスコード。

#### `serve.healthCheck.busy.body`

- **型:** `string` | `{ sh: string }`
- **必須:** No
- **デフォルト:** `'{"status":"busy","activeRequests":<N>}'`（`<N>` は実際の `activeRequests` 値）
- **説明:** レスポンスボディ。文字列指定と `sh:` によるコマンド実行の2形式をサポートする。詳細は `serve.healthCheck.idle.body` を参照。

#### `serve.webhooks`

`serve` コマンドで受け付ける webhook エンドポイントのリスト。

#### `serve.webhooks[].path`

- **型:** `string`
- **必須:** Yes
- **説明:** webhook のパス。例: `/webhook/mackerel`。難読パスを使うことでセキュリティを強化できる。`/`、`/index.html`、`/api/` で始まるパスは予約されており使用不可。同一 path の重複定義はエラー。

#### `serve.webhooks[].authType`

- **型:** `"none"` | `"basic"` | `"oidc"`
- **必須:** Yes
- **説明:** 認証方式。認証失敗時は `401` レスポンスと共に `WWW-Authenticate` ヘッダーを返す（`basic` → `Basic realm="prepalert"`、`oidc` → `Bearer realm="prepalert"`）。

#### `serve.webhooks[].headerPrompt`

- **型:** `string`
- **必須:** No
- **デフォルト:** `"The following alert has been received:"`
- **説明:** webhook で受信したリクエストボディの前に付与される prompt ヘッダー。最終的に Agent に渡される prompt は `"{headerPrompt}\n\nPlease format your response in Markdown.\n\n{request body}"` になる（Markdown 出力指示は自動付与）。webhook ごとにカスタマイズ可能。

#### `serve.webhooks[].sync`

- **型:** `boolean`
- **必須:** No
- **デフォルト:** `serve.syncMode` の値（未設定なら `false`）
- **説明:** この webhook の同期モード。`true` の場合、Agent の実行完了まで待ってから 200 OK を返す。`false` の場合は即座に 202 Accepted を返し、Agent はバックグラウンドで実行する。`dispatch` が設定されている場合、dispatch 元としての動作（Cloud Tasks にタスクを積んで即返す）はこの設定に関わらず常に非同期で行われる。ただし単一 path パターン（`dispatch.targetPath` 省略）で Cloud Tasks から呼び戻された場合は、同期的に処理される。

#### `serve.webhooks[].ecsTaskProtection`

- **型:** `"auto"` | `"off"`
- **必須:** No
- **デフォルト:** `serve.ecsTaskProtection` の値（未設定なら `"auto"`）
- **説明:** この webhook の ECS タスク保護設定。非同期モード（`sync: false`）かつ `dispatch` 未設定のときのみ有効。

#### `serve.webhooks[].username` / `serve.webhooks[].password`

- **型:** `string`
- **説明:** `authType: basic` の場合に使用。`${ENV_VAR}` で環境変数から注入可能。

#### `serve.webhooks[].issuer` / `serve.webhooks[].audience`

- **型:** `string`
- **説明:** `authType: oidc` の場合に使用。`issuer` から `.well-known/openid-configuration` → `jwksUri` を自動解決して JWT を検証する。

#### `serve.webhooks[].jwksUri`

- **型:** `string`
- **必須:** No
- **説明:** OIDC の JWKS エンドポイントを明示指定する。省略時は `issuer/.well-known/jwks.json` を使用。

#### `serve.webhooks[].dispatch`

外部キューサービスへの転送設定。設定するとこの webhook は受信したリクエストをキューに積んで即座にレスポンスを返す。実際の Agent 処理は、キューサービスが `targetPath`（または自分自身）を HTTP で叩くことで実行される。

**セキュリティに関する注意:** Cloud Run 環境では Cloud Tasks が付与するヘッダー（`X-CloudTasks-*`）は外部から偽装可能である（App Engine と異なりヘッダーの自動置換が行われない）。dispatch のターゲットとなる webhook には `authType: oidc` を設定し、Cloud Tasks の OIDC トークン（`dispatch.oidc` で設定）による認証を行うことを強く推奨する。`authType: none` のターゲットに対しては起動時に警告が出力される。

#### `serve.webhooks[].dispatch.type`

- **型:** `"cloud-tasks"` | `"aws-sqs"`
- **必須:** Yes（`dispatch` ブロックを定義する場合）
- **説明:** 使用する外部キューサービスの種類。discriminated union のタグフィールド。

#### `serve.webhooks[].dispatch.queue`

- **型:** `string`
- **必須:** Yes
- **説明:** Cloud Tasks キューのリソース名。形式: `projects/{project}/locations/{location}/queues/{queue}`。`${ENV_VAR}` で環境変数から注入可能。

#### `serve.webhooks[].dispatch.targetPath`

- **型:** `string`
- **必須:** No
- **デフォルト:** 自分自身の path（単一 path パターン）
- **説明:** Cloud Tasks がタスク実行時に叩く先の webhook パス。省略した場合は自分自身の path に戻す（単一 path パターン）。指定する場合は、同じ `webhooks` 内に定義された path を参照すること。

**二段 endpoint パターン:** `targetPath` に別の webhook の path を指定する。dispatch 用と処理用の endpoint が明確に分離される。

**単一 path パターン:** `targetPath` を省略する。Cloud Tasks からのコールバックは、タスク作成時に付与する `X-Prepalert-Dispatched` ヘッダおよび Cloud Tasks が付与する `X-CloudTasks-TaskName` ヘッダで判別し、いずれかがある場合は dispatch をスキップして直接処理する。`X-Prepalert-Dispatched` は prepalert-agent がタスク作成時に必ず付与する自前ヘッダであり、Cloud Tasks 側のヘッダが何らかの理由で欠けた場合でも無限ループを防止する。

単一 path パターンでは authType が1つしか設定できないため、`authType: basic` との併用はエラーになる（Cloud Tasks は basic 認証の credential を持たないため、コールバック時に認証が通らない）。外部からは basic 認証、Cloud Tasks からは OIDC で受けたい場合は二段 endpoint パターンを使用すること。

#### `serve.webhooks[].dispatch.baseUrl`

- **型:** `string`
- **必須:** No
- **デフォルト:** リクエストの `X-Forwarded-Proto` + `Host` ヘッダから構築
- **説明:** Cloud Tasks がタスク実行時に使用するベース URL。例: `https://my-service-xxx.run.app`。Cloud Run 等のリバースプロキシ環境ではリクエストヘッダから自動構築されるため、通常は省略可。ヘッダが信頼できない環境や、外部公開 URL が異なる場合に明示指定する。

#### `serve.webhooks[].dispatch.dispatchDeadline`

- **型:** `string`
- **必須:** No
- **デフォルト:** プロジェクトの `timeout` 設定値。`timeout` も未設定の場合は warn ログを出力し Cloud Tasks のデフォルトに従う
- **説明:** Cloud Tasks が 1 タスクの実行を待つ最大時間。duration 形式（`30m`, `1h` 等）。Agent 実行は長時間になりうるため、プロジェクトの `timeout` に合わせることを推奨する。短すぎるとタイムアウト → リトライ → 二重実行の原因になる。最大値は Cloud Tasks の制限（30分）に従う。

#### `serve.webhooks[].dispatch.oidc`

Cloud Tasks がタスク実行時に付与する OIDC トークンの設定。`targetPath` 先（または単一 path パターンの自分自身）が `authType: oidc` を要求する場合に必要。

#### `serve.webhooks[].dispatch.oidc.serviceAccountEmail`

- **型:** `string`
- **必須:** No
- **デフォルト:** GCP メタデータサーバーからデフォルトサービスアカウントのメールアドレスを取得
- **説明:** Cloud Tasks が OIDC トークン生成に使用するサービスアカウント。省略時は実行環境のメタデータサーバー（`/computeMetadata/v1/instance/service-accounts/default/email`）から取得する。サービスアカウントには `iam.serviceAccounts.actAs` 権限が必要。

#### `serve.webhooks[].dispatch.oidc.audience`

- **型:** `string`
- **必須:** No
- **デフォルト:** `dispatch.baseUrl` の値（baseUrl も未設定の場合はリクエストヘッダから構築した URL）
- **説明:** OIDC トークンの audience。通常は Cloud Run サービスの URL と一致させる。

### AWS SQS dispatch

`type: aws-sqs` の場合、リクエストを API Gateway v2 イベント形式に変換して SQS キューに送信する。Lambda + API Gateway v2 環境で使用する。

#### `serve.webhooks[].dispatch.queueUrl`

- **型:** `string`
- **必須:** Yes
- **説明:** SQS キューの URL。例: `https://sqs.ap-northeast-1.amazonaws.com/123456789012/my-queue`

#### `serve.webhooks[].dispatch.targetPath` (aws-sqs)

- **型:** `string`
- **必須:** No
- **デフォルト:** リクエストの元パス
- **説明:** SQS メッセージ内の API Gateway v2 イベントに設定する `rawPath`。cloud-tasks の `targetPath` と同様、別の webhook パスを指定することで二段 endpoint パターンを構成できる。

#### `serve.webhooks[].dispatch.baseUrl` (aws-sqs)

- **型:** `string`
- **必須:** No
- **デフォルト:** リクエストヘッダから構築
- **説明:** API Gateway v2 イベントの `domainName` に使用するベース URL。

## Permission とサブエージェントの関係

prepalert-agent は runbook をサブエージェント（AgentDefinition）として実行する。

- **permissionMode**: 親の設定がサブエージェントに継承される。`bypassPermissions`, `acceptEdits`, `auto` は継承後にサブエージェント側でオーバーライドできない
- **allowedTools / disallowedTools**: runbook 側で設定があればサブエージェントの AgentDefinition に `tools` / `disallowedTools` として上書きされる。省略時は親の設定を継承する

## 起動時 validation

`serve` コマンド起動時に以下の検証を行い、不整合があればエラーで終了する。

- 同一 path の重複定義
- `dispatch.targetPath` が `webhooks` 内に存在すること
- `dispatch.targetPath` の指す先に `dispatch` が設定されていないこと（多段転送・循環の防止）
- `dispatch.targetPath` の指す先が `authType: oidc` を要求する場合、`dispatch.oidc` の設定が存在する（または メタデータサーバーから取得可能な環境である）こと

## 例

### ECS 環境（従来構成）

```yaml
name: my-web-api-monitoring
model: sonnet
effort: medium
maxTurns: 10
costLimit: 1.0
timeout: 15m

instructions: |
  このプロジェクトは ECS 上で動く Web API を監視しています。
  調査結果は日本語でまとめてください。

serve:
  port: 8080
  ecsTaskProtection: auto
  webhooks:
    - path: /webhook/mackerel
      authType: basic
      headerPrompt: "The following Mackerel alert has been received:"
      username: ${MACKEREL_WEBHOOK_USER}
      password: ${MACKEREL_WEBHOOK_PASS}
```

### Cloud Run + Cloud Tasks（二段 endpoint パターン）

```yaml
name: my-web-api-monitoring
model: sonnet
timeout: 15m

serve:
  webhooks:
    # 受信用: Cloud Tasks にエンキューして即返す
    - path: /webhook/mackerel
      authType: basic
      username: ${MACKEREL_WEBHOOK_USER}
      password: ${MACKEREL_WEBHOOK_PASS}
      dispatch:
        type: cloud-tasks
        queue: ${CLOUD_TASKS_QUEUE}
        targetPath: /internal/process

    # 処理用: Cloud Tasks から叩かれて同期処理
    - path: /internal/process
      authType: oidc
      issuer: https://accounts.google.com
      audience: ${CLOUD_RUN_URL}
      sync: true
```

### Cloud Run + Cloud Tasks（単一 path パターン）

```yaml
name: my-web-api-monitoring
model: sonnet
timeout: 15m

serve:
  webhooks:
    # 1つの path で受信と処理を兼ねる
    # - 通常リクエスト → Cloud Tasks にエンキュー → 202
    # - X-CloudTasks-TaskName ヘッダあり → 同期処理 → 200
    - path: /webhook/mackerel
      authType: oidc
      issuer: https://accounts.google.com
      audience: ${CLOUD_RUN_URL}
      sync: true
      dispatch:
        type: cloud-tasks
        queue: ${CLOUD_TASKS_QUEUE}
```

### 混在構成（ECS + 同期 webhook）

```yaml
name: my-web-api-monitoring
model: sonnet
timeout: 15m

serve:
  ecsTaskProtection: auto
  webhooks:
    # 非同期 + ECS タスク保護（デフォルト）
    - path: /webhook/mackerel
      authType: basic
      username: ${MACKEREL_WEBHOOK_USER}
      password: ${MACKEREL_WEBHOOK_PASS}

    # この endpoint だけ同期モード
    - path: /webhook/external
      authType: oidc
      issuer: https://accounts.google.com
      audience: my-project
      sync: true
```

### Bedrock AgentCore Runtime 向け

AgentCore Runtime は `GET /ping` で `{"status":"Healthy"|"HealthyBusy","time_of_last_update":<unix_ts>}` を要求する。`HealthyBusy` + 最新の `time_of_last_update` を返している間はセッション（microVM）の自動終了が抑制される。

```yaml
name: my-web-api-monitoring
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
```
