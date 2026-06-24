# プロジェクト構造

## 概要

prepalert-agent のプロジェクトは `--project-dir` で指定するディレクトリ（デフォルト: `.`）をルートとする。

## ディレクトリレイアウト

```
<project-dir>/
├── prepalert.yaml          # プロジェクト設定 + Agent への共通指示
├── .mcp.json               # MCP サーバー設定
├── references/             # Agent が参照できる静的ドキュメント (optional)
│   └── *.md
├── runbooks/               # Runbook ファイル (required)
│   └── **/*.md
├── logs/                   # 運用ログ (自動生成、.gitignore 推奨)
│   └── {timestamp}-{id}.jsonl
└── sessions/               # セッション記録 (自動生成、.gitignore 推奨)
    └── YYYY/MM/DD/         # 日付パーティション
        └── {session-id}/
            ├── metadata.json       # セッションメタデータ (status, createdAt)
            ├── transcript.jsonl    # Agent のやり取り記録
            ├── report.md           # Session Report (Agent が create_report で生成)
            ├── output.md           # Agent の最終応答テキスト (serve モード)
            ├── artifacts/          # 補助ファイル (Agent が create_artifact で生成)
            │   └── {filename}
            └── runbooks/           # Runbook 別レポート (ハーネスが自動保存)
                └── {runbook-id}/
                    └── {tool-use-id}/
                        └── report.md
```

## 各ファイルの役割

### `prepalert.yaml`

プロジェクト全体の設定と Agent への共通指示を記述する。フィールド名は camelCase。詳細は [project-config.md](./project-config.md) を参照。

### `.mcp.json`

Agent が使用する MCP サーバーの設定。Claude Code の `.mcp.json` と同じフォーマットで、Agent SDK にそのまま渡される。Claude Code と共有可能（`mcpConfig` でパスを変更できる）。

```json
{
  "mcpServers": {
    "server-name": {
      "command": "...",
      "args": ["..."],
      "env": { "KEY": "VALUE" }
    }
  }
}
```

対応トランスポート: `stdio`, `sse`, `http` (Streamable HTTP)

### `references/`

Agent が調査中に参照できる静的なドキュメントを配置するディレクトリ。サービス構成図、運用手順の補足資料などを置く。Agent は Read ツールでこれらのファイルを読める。ディレクトリパスは設定で管理せず、instructions で直接パスを指示する。

### `runbooks/`

Runbook ファイルを格納するディレクトリ。Claude Code のスキル（`SKILL.md`）に似た構造で、YAML frontmatter + Markdown 本文で構成される。スキルと異なり、常に独立したサブエージェントとして実行される。サブディレクトリで自由に分類できる。再帰的に `.md` ファイルを読み込む。詳細は [runbook.md](./runbook.md) を参照。

### `logs/`

運用ログを保存するディレクトリ。プロセス起動ごとに JSON Lines ファイルが1つ作成される。HTTP リクエストの処理状況、Agent 実行の開始/完了、エラー等が構造化 JSON で記録される。パスは `logsDir` 設定で変更可能（デフォルト: `logs`）。

### `sessions/`

Agent 実行セッションの記録を保存するディレクトリ。1回の Agent 実行（webhook リクエストまたは対話セッション）ごとにセッション ID 付きのサブディレクトリが作成され、その中に `transcript.jsonl`（Agent のやり取り記録）が保存される。`serve` モードでは Agent の最終応答が `output.md` としても保存される。パスは `sessionsDir` 設定で変更可能（デフォルト: `sessions`）。

## CLI

### 共通オプション

| オプション | 説明 | デフォルト |
|---|---|---|
| `--project-dir <dir>` | プロジェクトディレクトリのパス | `.` |
| `--log-level <level>` | ログレベル (`debug` \| `info` \| `warn` \| `error`) | `info` |

`--log-level` は環境変数 `PREPALERT_LOG_LEVEL` でも設定可能（CLI フラグが優先）。

**出力動作:**

| モード | stderr | ファイル | stdout |
|---|---|---|---|
| `run`（対話） | warn 以上 | JSONL | Agent 応答テキスト |
| `run -p` | 指定レベル以上の全 JSONL | JSONL | 最終応答テキストのみ |
| `serve` | 指定レベル以上の全 JSONL | JSONL | — (`sessions/{id}/output.md` に保存) |

対話モードでは `--interactive-log-level` で個別にログレベルを指定可能（未指定時は `--log-level` にフォールバック）。

### サブコマンド

### `run`（デフォルト）

デフォルトコマンド。サブコマンド省略時にも起動する。

#### 対話モード: `prepalert-agent` / `prepalert-agent run`

1. Agent SDK の query を AsyncIterable（ストリーミング入力）モードで起動。MCP サーバーの接続はバックグラウンドで開始
2. readline で `>` プロンプトを表示し、ユーザー入力を待つ
3. `system/init` メッセージで MCP サーバーの接続状態を取得・キャッシュ
4. ユーザーの指示に応じて runbook サブエージェントや Explore エージェントを委譲、MCP ツールで調査
5. `exit` または Ctrl+D で終了

**ビルトインコマンド:**

| コマンド | 説明 | query 起動 |
|---|---|---|
| `/help` | コマンド一覧を表示 | 不要 |
| `/mcp` | MCP サーバーの接続状態を表示。query 未起動時は設定情報のみ | 不要 |
| `/mcp test` | プロジェクトの MCP サーバーへの接続テストを実行。pending/failed のサーバーに reconnect を試みる | lazy 起動 |
| `/status` | プロジェクト設定とアカウント情報を表示 | lazy 起動 |
| `/reset` | TotalCost とターン数のカウンターをリセット | 不要 |
| `exit` / `/exit` | セッション終了 | 不要 |

**Permission:** `-m` / `--interactive-permission-mode` フラグで指定（デフォルト: `default`）。環境変数 `PREPALERT_PERMISSION_MODE` でも設定可能。

| モード | 挙動 |
|---|---|
| `default` | `canUseTool` コールバックで readline 確認。`(y)es` / `(n)o` / `(a)lways` |
| `auto` | model classifier が自動判定 |
| `acceptEdits` | ファイル編集は自動許可、それ以外は確認 |
| `dontAsk` | `allowedTools` のみ許可、それ以外は拒否。確認なし |

#### ヘッドレスモード: `prepalert-agent -p "<prompt>"` / `prepalert-agent -p -`

1. `-p` の引数を prompt として使用。`-p -` の場合は stdin から全文を読み取り
2. Agent SDK の query を string prompt（シングルターン）モードで起動
3. 実行完了後に最終応答テキストを stdout に出力して終了（JSONL ログは stderr）

**Permission:** `dontAsk` モード固定。`allowedTools` に列挙されたツールのみ実行可能。デフォルトは Read 系ツール + MCP 全サーバー。

### `serve`

Webhook サーバーを起動する。

1. `Bun.serve()` で HTTP サーバーを起動
2. `GET /health` — ヘルスチェック。`{ "status": "idle" | "busy", "activeRequests": <number> }` を返す
3. `serve.webhooks` 設定に基づいてパスごとにルーティング
4. 認証チェック（none / basic / oidc）
5. `headerPrompt + markdown出力指示 + "\n\n" + request body` を prompt として構築（markdown 指示は自動付与）
6. `run -p` と同じヘッドレスモードで Agent を実行
7. Agent の応答を `sessions/{session-id}/output.md` に保存
8. `serve.syncMode: false`（デフォルト）→ 即 202 Accepted、Agent はバックグラウンド実行
9. `serve.syncMode: true` → Agent 完了まで待って 200 OK
10. ECS 環境では非同期モード時に自動でタスク保護を有効化（`serve.ecsTaskProtection: auto`）

**予約パス:** `/`、`/index.html`、`/api/` から始まるパスは webhook に使用できない（設定するとサーバー起動時にエラー）。

**Permission:** `run -p` と同じヘッドレスモード（`dontAsk` + `allowedTools`）。

### `init`

プロジェクトの初期化（scaffolding）。`prepalert.yaml`、`.mcp.json`、`runbooks/example/`、`.gitignore` を生成する。AI 不要。詳細は [init.md](./init.md) を参照。

### `skills`

prepalert-agent が提供するスキルファイルを Claude Code 等にインストール・管理する。サブコマンド: `list`, `install`, `update`, `uninstall`, `status`。インストール先は `project`（`.claude/skills/`）または `user`（`~/.claude/skills/`）。AI 不要。詳細は [install-skills.md](./install-skills.md) を参照。
