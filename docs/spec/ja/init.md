# `init` サブコマンド

## 概要

プロジェクトディレクトリに prepalert-agent の初期ファイル群を生成する scaffolding コマンド。AI（Anthropic API）を必要としない。

## 使い方

```bash
prepalert-agent init [--project-dir <dir>]
```

## 生成物

```
<project-dir>/
├── prepalert.yaml
├── .mcp.json               # 既存なければ生成
├── .gitignore              # 既存なければ生成、あれば追記確認
└── runbooks/
    └── example/
        └── 5xx-rate.md     # サンプル runbook
```

## ファイル生成ルール

### `prepalert.yaml`

- 既に存在する場合はエラー終了（「既に初期化済みです」）
- 最小限のテンプレートを生成する

生成テンプレート:

```yaml
# Project name (used for logging and identification)
name: <project-dir のディレクトリ名>

# Model for the agent to use (e.g. haiku, sonnet, opus)
model: haiku

# Reasoning effort level (low, medium, high, xhigh, max)
# effort: medium

# Maximum number of turns per agent execution
maxTurns: 10

# Cost limit per execution in USD
# costLimit: 1.0

# Execution timeout (e.g. "30s", "15m", "1h"). Headless/serve mode only.
# timeout: 15m

# Directory for runbook files
# runbooksDir: runbooks

# Path to MCP server configuration
# mcpConfig: .mcp.json

# Common instructions for the agent (inline or from file, mutually exclusive)
# instructions: |
#   Write instructions for the agent here.
# instructionsFile: PREPALERT.md

# Serve command configuration
# serve:
#   port: 8080
#   syncMode: false
#   webhooks:
#     - path: /webhook/alert
#       authType: none
```

### `.mcp.json`

- 既に存在する場合はスキップ（触らない）
- 存在しない場合は空テンプレートを生成する

生成テンプレート:

```json
{
  "mcpServers": {}
}
```

### `.gitignore`

- 存在しない場合: `logs/` と `sessions/` を含む `.gitignore` を生成
- 既に存在する場合: `logs/` と `sessions/` が未記載であれば、追記するかどうかをユーザーに確認する（対話プロンプト）
- 既に両方記載済みの場合: スキップ

### `runbooks/example/`

- `runbooks/` ディレクトリを作成し、`example/` サブディレクトリにサンプル runbook を配置する
- `runbooks/` が既に存在してもエラーにしない（`example/` を追加するのみ）
- `runbooks/example/` が既に存在する場合はスキップ

サンプル runbook は MCP サーバー固有のツール名を使わず、runbook の構造（frontmatter + 手順）を示す汎用的な内容にする。

## 動作フロー

1. `prepalert.yaml` の存在チェック → 存在すればエラー終了
2. `prepalert.yaml` を生成
3. `.mcp.json` が存在しなければ生成
4. `runbooks/example/` が存在しなければサンプル runbook を生成
5. `.gitignore` の処理（生成 or 追記確認）
6. 生成したファイルの一覧を表示

## 対話モードとの関係

対話モード (`prepalert-agent run`) のビルトインコマンド `/init` は、内部的に `initialize-prepalert-project` スキルを実行する。このスキルは `init` サブコマンドと同等の scaffolding を行った上で、AI がプロジェクトの文脈（`.mcp.json` の MCP サーバー構成等）を読み取り、実用的な runbook を生成する。詳細は [install-skills.md](./install-skills.md) を参照。
