# Runbook Specification

## Overview

A Runbook is a Markdown file that defines investigation procedures for the Agent to execute as a sub-agent when an alert fires. It has a structure similar to Claude Code skills (`SKILL.md`), but differs in that it always runs as an independent sub-agent. Runbooks are placed as `.md` files under `runbooksDir` (default: `runbooks/`). They can be organized using subdirectories and are loaded recursively.

## File Layout

```
runbooks/
├── web-api/
│   ├── 5xx-rate-over-limit.md
│   └── latency-spike.md
└── database/
    └── connection-pool-exhausted.md
```

## ID

The relative path from `runbooksDir` with the extension removed.

| File Path | ID |
|---|---|
| `runbooks/web-api/5xx-rate-over-limit.md` | `web-api/5xx-rate-over-limit` |
| `runbooks/database/connection-pool-exhausted.md` | `database/connection-pool-exhausted` |

## File Structure

YAML frontmatter + Markdown body.

```markdown
---
description: <string>             # Description of the runbook (required)
name: <string>                    # Unique identifier (optional, defaults to generated from ID)
trigger: <string>                 # What kind of alert triggers this runbook (optional)
model: <string>                   # Model override (optional)
effort: <string>                  # Reasoning effort level (optional)
maxTurns: <number>                # Maximum number of turns (optional)
costLimit: <number>               # Cost limit in USD (optional)
allowedTools: <string[]>          # Tools allowed for use (optional)
disallowedTools: <string[]>       # Disallowed tools (optional)
---

Body: Instructions for the Agent's investigation procedures. Written in Markdown.
```

## Frontmatter Fields

### `description`

- **Type:** `string`
- **Required:** Yes
- **Description:** A description of what the runbook does. Used by the Agent as a basis for selecting the appropriate runbook.

### `name`

- **Type:** `string`
- **Required:** No
- **Default:** Generated from the ID (e.g., `web-api/5xx-rate-over-limit` → `web-api/5xx-rate-over-limit`)
- **Description:** A unique identifier for the runbook. When omitted, the file-path-based ID is used as-is.

### `trigger`

- **Type:** `string`
- **Required:** No
- **Description:** Describes in natural language the alert conditions this runbook handles. The Agent matches the alert content against the trigger to determine which runbook to execute.

### `model`

- **Type:** `string`
- **Required:** No
- **Default:** `model` from `prepalert.yaml`
- **Description:** Model override for this runbook's execution. e.g., `sonnet`, `opus`, `haiku`.

### `effort`

- **Type:** `"low"` | `"medium"` | `"high"` | `"xhigh"` | `"max"`
- **Required:** No
- **Default:** `effort` from `prepalert.yaml`
- **Description:** Reasoning effort level for this runbook's execution. Use `low` for fast triage and `high` for thorough investigation.

### `maxTurns`

- **Type:** `number`
- **Required:** No
- **Default:** `maxTurns` from `prepalert.yaml`
- **Description:** Maximum number of turns for this runbook's execution.

### `costLimit`

- **Type:** `number`
- **Required:** No
- **Default:** `costLimit` from `prepalert.yaml`
- **Description:** Cost limit in USD for this runbook's execution. Allows per-runbook cost control independent of the project-wide `costLimit`.

### `allowedTools`

- **Type:** `string[]`
- **Required:** No
- **Default:** All tools (no restrictions)
- **Description:** Tools available for use during this runbook's execution. Supports glob patterns. e.g., `["mcp__mackerel__*", "mcp__aws-mcp__*"]`. When omitted, inherits all tools available from the project's MCP servers.

### `disallowedTools`

- **Type:** `string[]`
- **Required:** No
- **Default:** None
- **Description:** Tools disallowed during this runbook's execution. Takes precedence over `allowedTools`. e.g., `["Bash", "Edit", "Write"]`.

## Body

The text that serves as the prompt when the Agent executes the runbook as a sub-agent. The Agent follows these instructions to investigate using MCP tools and other available tools.

Free-form Markdown. Writing steps as a numbered list is recommended.

**Note on execution environment:** Runbooks may be executed inside a container in `serve` mode. Since the container may not contain the application's source code, investigation procedures should be designed to work entirely with MCP tools. The Agent will opportunistically use `Read`/`Grep` etc. if the codebase is available, but runbook procedures should not depend on it.

## Inheritance Model

Runbook fields inherit project defaults from `prepalert.yaml` and can be overridden individually.

| Field | Fallback When Omitted |
|---|---|
| `model` | `model` from `prepalert.yaml` |
| `effort` | `effort` from `prepalert.yaml` |
| `maxTurns` | `maxTurns` from `prepalert.yaml` |
| `costLimit` | `costLimit` from `prepalert.yaml` |

## Example

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
