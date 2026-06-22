---
name: prepalert-agent
version: "0.0.1"
description: |
  Alert response agent tool - configure projects, author runbooks, set up webhook servers, and initialize alert response workflows.
  Trigger: When the user asks about prepalert-agent usage, configuration, runbook authoring, serve setup, or wants to initialize an alert response project.
license: MIT
compatibility:
  - claude
  - codex
  - agents
allowed_tools:
  - Bash
  - Read
  - Grep
  - Glob
---

# prepalert-agent Skill

## Overview

prepalert-agent is a CLI tool that automatically collects logs and related information when alerts fire. It uses Claude Agent SDK to flexibly investigate situations instead of running fixed queries.

## CLI Commands

```bash
# Initialize a new project (scaffolding)
prepalert-agent init

# Run interactively
prepalert-agent run

# Run headless with a prompt
prepalert-agent run -p "Investigate the 5xx rate spike alert"

# Start webhook server
prepalert-agent serve

# Manage skills
prepalert-agent skills list
prepalert-agent skills install --scope user

# Browse documentation
prepalert-agent docs --list
prepalert-agent docs --index --article project-config
prepalert-agent docs --search "webhook" --json
```

## Project Configuration (`prepalert.yaml`)

Core configuration file at the project root. For full field reference, use `prepalert-agent docs --article project-config --json` or the `docs_search` tool in interactive sessions. See [references/instructions-guide.md](references/instructions-guide.md) for writing effective `instructions`.

### Key Fields

```yaml
name: my-project                    # Project name (required)
model: haiku                        # Agent model: haiku, sonnet, opus
effort: medium                      # Reasoning effort: low, medium, high, xhigh, max
maxTurns: 10                        # Max agent turns per execution
costLimit: 1.0                      # Cost limit per execution (USD)
timeout: 15m                        # Execution timeout (e.g. "30s", "15m", "1h")

runbooksDir: runbooks               # Runbook directory path
mcpConfig: .mcp.json                # MCP server configuration path
logsDir: logs                       # Operation log directory
sessionsDir: sessions               # Session record directory
storage: s3://bucket/prefix/        # Persistent storage URL (S3 or GCS)

instructions: |                     # Agent instructions (inline)
  Web API on ECS. Depends on PostgreSQL + Redis.
instructionsFile: PREPALERT.md      # Or load from file (mutually exclusive with instructions)
```

### Environment Variable Expansion

String values support `${VAR}` expansion with bash-compatible syntax:
- `${VAR}` — expand, error if unset
- `${VAR:-default}` — use default if unset or empty
- `${VAR-default}` — use default if unset (empty string stays)
- `${VAR:+alternate}` — use alternate if set and non-empty
- `${VAR?message}` — error with message if unset

### Duration Syntax

Timeout and similar fields accept: `30s`, `5m`, `1h`, `1h30m`, `2h15m30s`.

## Runbook Authoring

Runbooks define alert investigation procedures. See [references/runbook-template.md](references/runbook-template.md) for templates and patterns.

### Structure

```markdown
---
description: What this runbook does
trigger: Alert condition in natural language
model: haiku
effort: low
maxTurns: 5
costLimit: 0.10
allowedTools:
  - mcp__grafana__*
  - mcp__aws__*
---

1. Retrieve alert details
2. Check recent logs for error patterns
3. Summarize findings with timeline
```

### Key Design Principles

- Runbooks execute as sub-agents with their own model/effort/cost settings
- `allowedTools` restricts which MCP tools the sub-agent can use (wildcards supported)
- Runbooks may execute in serve mode containers **without source code access** — design steps around MCP tools, not codebase reading
- Match `model` and `effort` to complexity: triage → `haiku` + `low`, deep investigation → `sonnet` + `medium`

### File Organization

Organize by failure surface category:
```
runbooks/
├── web-api/
│   ├── 5xx-rate.md
│   └── latency.md
├── database/
│   └── connection-pool.md
└── worker/
    └── queue-depth.md
```

## Serve Setup (Webhook Server)

```yaml
serve:
  port: 8080
  syncMode: false                   # true: wait for agent completion
  ecsTaskProtection: auto           # auto | off

  webhooks:
    - path: /webhook/alert
      authType: none
    - path: /webhook/secure
      authType: basic
      username: ${WEBHOOK_USER}
      password: ${WEBHOOK_PASS}
    - path: /webhook/oidc
      authType: oidc
      issuer: https://accounts.google.com
      audience: my-project

  auth:                             # OIDC auth for SPA + API
    issuer: https://accounts.google.com
    clientId: ${OAUTH_CLIENT_ID}
    clientSecret: ${OAUTH_CLIENT_SECRET}
    allowedDomains:
      - example.com

  exportSecret: ${PREPALERT_EXPORT_SECRET}
  baseUrl: https://prepalert.example.com
```

### Auth Modes

| Mode | Use Case |
|---|---|
| `none` | Internal/trusted networks |
| `basic` | Simple webhook authentication |
| `oidc` | JWT token verification for external services |

### SPA Authentication

When `serve.auth` is configured, the built-in SPA and API endpoints require OIDC login. `allowedDomains` restricts which email domains can access.

## Project Initialization Workflow

When initializing a new prepalert-agent project for an existing application, follow these phases. Use Explore sub-agents for Phases 2 and 3 to gather information in parallel.

### Phase 1: Big Picture

1. Read README.md, CLAUDE.md, AGENTS.md, docs/ to understand the application
2. Determine project structure (monorepo vs single app)
3. Identify runtime and major dependencies
4. Look for deployment clues (Dockerfile, terraform/, serverless.yml, etc.)
5. Look for config templates (.env.example, config/, etc.)
6. Summarize: "what app, running where" in one sentence

### Phase 2: Identify Failure Surfaces

Search for:
- **External dependencies:** database connections, caches, external API calls, message queues
- **Entry points:** HTTP handlers, Lambda handlers, worker files, routing definitions
- **Error handling patterns:** error types, catch patterns, retry logic
- **Existing alert configuration:** monitoring service configs, alert payload formats

Search hints: `DATABASE_URL`, `REDIS`, `SQS`, `http.Client`, `fetch(`, `handler`, `router`, `catch`, `panic`, `retry`

### Phase 3: Map Observability

1. **Logging:** library (slog, zap, winston, pino), output destination, structured or not
2. **Metrics:** monitoring service (Mackerel, Datadog, Grafana, CloudWatch), custom metrics
3. **Tracing:** OpenTelemetry config, service name, trace ID propagation

If no monitoring config is in the repository, infer from `.mcp.json` and dependency files.

### Phase 4: Connect with Tools

1. Read `.mcp.json` and list available MCP servers
2. Understand what each MCP server provides
3. Cross-reference failure surfaces with MCP tools to build a runbook candidate list:
   ```
   - [Failure] 5xx rate spike → [Tools] monitoring(alert details) + logging(error log search)
   - [Failure] DB connection exhaustion → [Tools] monitoring(metrics) + cloud(DB metrics)
   ```

### Phase 5: User Confirmation

Present findings and ask:
- Additions or removals to the runbook candidate list
- Language for investigation results
- Whether to add reference documents

### Phase 6: Generate

1. Write `prepalert.yaml` `instructions` following [references/instructions-guide.md](references/instructions-guide.md)
2. Generate runbook files following [references/runbook-template.md](references/runbook-template.md)

### Phase 7: Final Review

Present generated files and ask if adjustments are needed.

## Troubleshooting

### MCP Server Connection Issues

Check `.mcp.json` configuration. Verify MCP servers are running:
```bash
# List configured MCP servers
cat .mcp.json | jq '.mcpServers | keys'
```

### Permission Mode Selection

| Mode | Use Case |
|---|---|
| `default` | Standard interactive use |
| `acceptEdits` | Auto-accept file edits |
| `bypassPermissions` | Skip all permission prompts |
| `plan` | Planning mode only |

### Log Investigation

```bash
# Check operation logs
ls logs/

# View specific session
ls sessions/YYYY/MM/DD/<session-id>/
```
