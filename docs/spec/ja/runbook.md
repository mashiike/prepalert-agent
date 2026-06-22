# Runbook 仕様

## 概要

Runbook はアラート発火時に Agent がサブエージェントとして実行する調査手順を定義する Markdown ファイル。Claude Code のスキル（`SKILL.md`）に似た構造だが、常に独立したサブエージェントとして実行される点が異なる。`runbooksDir`（デフォルト: `runbooks/`）配下に `.md` ファイルとして配置する。サブディレクトリによる分類が可能で、再帰的に読み込まれる。

## ファイル配置

```
runbooks/
├── web-api/
│   ├── 5xx-rate-over-limit.md
│   └── latency-spike.md
└── database/
    └── connection-pool-exhausted.md
```

## ID

`runbooksDir` からの相対パスで拡張子を除いたもの。

| ファイルパス | ID |
|---|---|
| `runbooks/web-api/5xx-rate-over-limit.md` | `web-api/5xx-rate-over-limit` |
| `runbooks/database/connection-pool-exhausted.md` | `database/connection-pool-exhausted` |

## ファイル構造

YAML frontmatter + Markdown 本文。

```markdown
---
description: <string>             # runbook の説明 (required)
name: <string>                    # 一意識別子 (optional, デフォルトはIDから生成)
trigger: <string>                 # どのようなアラートで発動するか (optional)
model: <string>                   # モデルオーバーライド (optional)
effort: <string>                  # 推論努力レベル (optional)
maxTurns: <number>                # 最大ターン数 (optional)
costLimit: <number>               # コスト上限 USD (optional)
allowedTools: <string[]>          # 使用可能なツール (optional)
disallowedTools: <string[]>       # 禁止ツール (optional)
---

本文: Agent への調査手順の指示。Markdown 形式。
```

## Frontmatter フィールド

### `description`

- **型:** `string`
- **必須:** Yes
- **説明:** runbook が何をするかの説明。Agent が runbook を選択する際の判断材料になる。

### `name`

- **型:** `string`
- **必須:** No
- **デフォルト:** ID から生成（例: `web-api/5xx-rate-over-limit` → `web-api/5xx-rate-over-limit`）
- **説明:** runbook の一意識別子。省略時はファイルパスベースの ID がそのまま使用される。

### `trigger`

- **型:** `string`
- **必須:** No
- **説明:** この runbook が対応するアラートの条件を自然言語で記述する。Agent がアラート内容と trigger を照合して、実行すべき runbook を判断する。

### `model`

- **型:** `string`
- **必須:** No
- **デフォルト:** `prepalert.yaml` の `model`
- **説明:** この runbook 実行時に使用するモデルのオーバーライド。`sonnet`, `opus`, `haiku` 等。

### `effort`

- **型:** `"low"` | `"medium"` | `"high"` | `"xhigh"` | `"max"`
- **必須:** No
- **デフォルト:** `prepalert.yaml` の `effort`
- **説明:** この runbook 実行時の推論努力レベル。トリアージ系は `low` で速く、本格調査は `high` でじっくり、のように使い分ける。

### `maxTurns`

- **型:** `number`
- **必須:** No
- **デフォルト:** `prepalert.yaml` の `maxTurns`
- **説明:** この runbook 実行時の最大ターン数。

### `costLimit`

- **型:** `number`
- **必須:** No
- **デフォルト:** `prepalert.yaml` の `costLimit`
- **説明:** この runbook 実行時のコスト上限（USD）。プロジェクト全体の `costLimit` とは別に、runbook 単位でコストを制御できる。

### `allowedTools`

- **型:** `string[]`
- **必須:** No
- **デフォルト:** 全ツール（制限なし）
- **説明:** この runbook 実行時に使用可能なツール。glob パターン対応。例: `["mcp__mackerel__*", "mcp__aws-mcp__*"]`。省略時はプロジェクトの MCP サーバーで利用可能な全ツールを継承する。

### `disallowedTools`

- **型:** `string[]`
- **必須:** No
- **デフォルト:** なし
- **説明:** この runbook 実行時に禁止するツール。`allowedTools` より優先される。例: `["Bash", "Edit", "Write"]`。

## 本文

Agent がサブエージェントとして runbook を実行する際のプロンプトになるテキスト。Agent はこの手順に従って MCP ツール等を使い調査を行う。

自由形式の Markdown。番号付きリストで手順を書くのが推奨。

**実行環境に関する注意:** runbook は `serve` モードのコンテナ内で実行されることがある。コンテナにアプリケーションのソースコードが含まれるとは限らないため、調査手順は MCP ツールだけで完結するように設計すること。Agent はコードベースがあれば `Read`/`Grep` 等を日和見的に活用するが、runbook の手順としてはそれに依存しないようにする。

## 継承モデル

runbook のフィールドは `prepalert.yaml` のプロジェクトデフォルトを継承し、個別に上書きできる。

| フィールド | 省略時のフォールバック |
|---|---|
| `model` | `prepalert.yaml` の `model` |
| `effort` | `prepalert.yaml` の `effort` |
| `maxTurns` | `prepalert.yaml` の `maxTurns` |
| `costLimit` | `prepalert.yaml` の `costLimit` |

## 例

```markdown
---
description: CloudWatch Logsから初期のログ調査をするためのrunbook
trigger: 「サービス X の 5xx 率が 5% を超えました」というアラートの場合
model: haiku
effort: low
maxTurns: 5
costLimit: 0.10
allowedTools:
  - mcp__mackerel__*
  - mcp__aws-mcp__*
---

1. Mackerelへアラートの情報を取得しに行き、どのサービスなのかを調べに行く
2. aws-mcp を利用して、対象サービスのCloudWatch Logsを確認しに行く
```
