# CLAUDE.md

## プロジェクト概要

prepalert-agent は、アラート発火時にログや関連情報を自動収集する CLI ツール。
既存の [prepalert](https://github.com/mashiike/prepalert)（Go, HCL ベース）の発展形で、Claude Agent SDK を使って固定クエリではなく Agent が状況に応じて柔軟に情報収集を行う。

## 技術スタック

- **言語:** TypeScript (ESM)
- **ランタイム:** Bun (ワンバイナリビルドに `bun build --compile` を使用)
- **Node.js:** 26.x (asdf で管理、`.tool-versions` 参照)
- **パッケージマネージャー:** Bun
- **CLI フレームワーク:** commander
- **Agent SDK:** @anthropic-ai/claude-agent-sdk
- **JWT 検証:** jose
- **YAML パース:** yaml
- **コンテナイメージ:** `ghcr.io/mashiike/prepalert-agent`（node:26-slim + uv/uvx）

## コマンド

```bash
bun run dev          # 開発時の実行
bun run build        # TypeScript コンパイル (tsc)
bun run compile      # ワンバイナリビルド (bun build --compile)
bun run start        # dist/index.js を実行
bun test             # テスト実行
```

## サブコマンド

- `run` (デフォルト) — 対話モード（引数なし）またはヘッドレスモード（`-p` 付き）
- `serve` — Webhook サーバーの起動。認証（none/basic/oidc）、同期/非同期モード、ECS タスク保護に対応
- `init` — アラート対応プロジェクトの初期化（scaffolding）
- `skills` — スキル管理（list/install/update/uninstall/status）
- `docs` — ドキュメント表示（--list/--index/--search/--article/--json）
- `--version` — バージョン情報

共通フラグ: `--project-dir <dir>`（デフォルト `.`）、`--log-level <level>`（`debug` | `info` | `warn` | `error`、デフォルト `info`、環境変数 `PREPALERT_LOG_LEVEL` でも設定可）
run 固有フラグ: `-p <prompt>`（ヘッドレス）、`-m <mode>`（permission モード）、`--interactive-log-level <level>`（対話モード用ログレベル）
serve 固有フラグ: `--port <port>`

### 出力動作

| モード | stderr | ファイル | stdout |
|---|---|---|---|
| `run`（対話） | warn 以上 | JSONL | Agent 応答テキスト |
| `run -p` | minLevel 以上の全 JSONL | JSONL | 最終応答テキスト |
| `serve` | minLevel 以上の全 JSONL | JSONL | — (`sessions/{id}/output.md` に出力) |

## ディレクトリ構成

```
src/
├── index.ts              # CLI エントリポイント
├── project.ts            # プロジェクト読み込み (prepalert.yaml, .mcp.json, runbooks)
├── config.ts             # 環境変数展開、duration パース
├── auth.ts               # 認証ロジック (none, basic, oidc)
├── dispatch.ts           # Cloud Tasks ディスパッチ
├── ecs.ts                # ECS タスク保護
├── logger.ts             # Logger interface + FileLogger / StderrLogger / QuietLogger
├── transcript.ts         # TranscriptWriter interface + LocalTranscriptWriter + SDK イベント変換
├── storage.ts            # SessionStorage interface + S3SessionStorage + LocalSessionStorage + ファクトリ
├── session-writer.ts     # SessionWriter (transcript バッファ + ストレージ委譲)
├── session-tools.ts      # create_report / create_artifact カスタムツール
├── docs.ts               # ドキュメントパーサー (セクション分割 + 検索)
├── docs-tools.ts         # 対話モード用 docs カスタムツール (docs_list/docs_index/docs_search/docs_read)
├── api.ts                # API ルートハンドラ (/api/*)
├── spa.ts                # SPA index.html ハンドラ
├── export-token.ts       # Export URL の JWT 生成・検証
├── auth-session.ts       # OIDC 認証 + session cookie 管理
├── telemetry.ts          # OpenTelemetry 初期化 + OTelLogger + SessionTelemetry
├── commands/
│   ├── agents.ts         # 組み込みエージェント定義 (Explore) + Runbook エージェントビルダー
│   ├── prompt.ts         # システムプロンプト + クエリオプションビルダー
│   ├── execute.ts        # executePrompt (ヘッドレス) / executeInteractive (対話) / ビルトインコマンド
│   ├── init.ts           # init コマンド (scaffolding)
│   ├── skills.ts         # skills コマンド（list/install/update/uninstall/status）
│   ├── docs.ts           # docs コマンド（--list/--index/--search/--json）
│   └── serve.ts          # serve コマンド (Bun.serve HTTP サーバー + SPA + API)
└── __tests__/            # テスト
    ├── project.test.ts
    ├── execute.test.ts
    ├── config.test.ts
    ├── auth.test.ts
    ├── serve.test.ts
    ├── logger.test.ts
    ├── transcript.test.ts
    ├── telemetry.test.ts
    └── fixtures/
        └── alerts/
            └── web-api-5xx.json

_examples/                # サンプルプロジェクト
├── prepalert.yaml
├── .mcp.json
├── references/
│   └── service-map.md
└── runbooks/
    └── web-api/
        └── 5xx-rate-over-limit.md

skills/                   # skills コマンドでインストールされるスキルファイル
└── prepalert-agent/
    ├── SKILL.md
    └── references/
        ├── instructions-guide.md
        └── runbook-template.md

docs/spec/ja/             # 仕様ドキュメント（日本語、マスター）
docs/spec/en/             # 仕様ドキュメント（英語）
```

## プロジェクト設定の概要

- `prepalert.yaml` — プロジェクト設定 + instructions（詳細は `docs/spec/ja/project-config.md`）。フィールド名は camelCase
- `.mcp.json` — MCP サーバー設定（Claude Code と同フォーマット、共有可能）
- `runbooks/` — Runbook ファイル（詳細は `docs/spec/ja/runbook.md`）。Claude Code のスキルに似た構造で、常にサブエージェントとして実行される
- `logs/` — 運用ログ（JSON Lines）。`logsDir` 設定で変更可能
- `sessions/` — セッション記録。日付パーティション構造（`YYYY/MM/DD/{session-id}/`）。`sessionsDir` 設定で変更可能
- `storage` — 永続ストレージ URL（`s3://bucket/prefix/` or `gs://bucket/prefix/`）。未設定時は `sessionsDir` がそのまま永続先
- `storageOptions` — S3 互換ストレージ用オプション（`endpoint`, `forcePathStyle`, `region`）

### serve 固有の設定

- `serve.exportSecret` — Export URL の JWT 署名用秘密鍵。未設定時は起動時に自動生成（再起動で無効化）
- `serve.baseUrl` — Export URL のドメイン。未設定時はリクエストヘッダから自動推定
- `serve.staticDir` — フロントエンドの静的ファイルディレクトリ。未設定時は組み込み SPA を使用

## リリース

tagpr によるセマンティックバージョニング。main への push でリリース PR が自動作成され、マージ時にタグ打ち → bun クロスコンパイルで GitHub Release にバイナリをアップロード。同時に ghcr.io へコンテナイメージ（linux/amd64, linux/arm64）を push。

## 開発ルール

### OSS リポジトリとしての注意事項

- **秘匿情報をコミットしない:** API キー、トークン、認証情報、.env ファイル等をコミットしない。`.gitignore` に含まれていることを確認する
- **ライセンス:** MIT ライセンス。サードパーティのコードやアセットを追加する場合はライセンス互換性を確認する
- **依存関係:** 新しい依存を追加する際はライセンスを確認する（GPL 系は MIT と非互換）

### ドキュメント

- 仕様ドキュメントは **日本語版（`docs/spec/ja/`）がマスター**。英語版（`docs/spec/en/`）は翻訳
- ドキュメントを変更する場合は **日本語と英語の両方を必ず更新する**
- README は `README.md`（英語）と `README.ja.md`（日本語）の両方がある。日本語版がマスター

### コード規約

- グローバルの `~/.claude/CLAUDE.md` および `~/.claude/rules/` のルールに従う
- TypeScript strict モード（`exactOptionalPropertyTypes: true` に注意）
- ESM (`import`/`export`) を使用。CommonJS (`require`) は使わない
- テストは `bun:test` を使用。テストファイルは `src/__tests__/` 配下
