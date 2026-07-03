# prepalert-agent

[日本語](README.ja.md)

A CLI tool that automatically collects logs and related information when alerts fire, powered by [Claude Agent SDK](https://github.com/anthropics/claude-agent-sdk-typescript).

This is the successor to [prepalert](https://github.com/mashiike/prepalert) — instead of declarative HCL queries, it uses an AI agent to flexibly gather relevant context based on the alert content.

## Installation

Download the archive for your platform from [GitHub Releases](https://github.com/mashiike/prepalert-agent/releases):

| Platform | Archive |
|---|---|
| Linux (x86_64) | `prepalert-agent_linux_amd64.tar.gz` |
| Linux (arm64) | `prepalert-agent_linux_arm64.tar.gz` |
| macOS (Intel) | `prepalert-agent_darwin_amd64.tar.gz` |
| macOS (Apple Silicon) | `prepalert-agent_darwin_arm64.tar.gz` |

Each release also includes a `checksums.txt` with SHA-256 sums for all archives. Verify and extract:

```bash
VERSION=v0.1.0 # replace with the version you downloaded
ARCHIVE=prepalert-agent_linux_amd64.tar.gz

curl -LO https://github.com/mashiike/prepalert-agent/releases/download/${VERSION}/${ARCHIVE}
curl -LO https://github.com/mashiike/prepalert-agent/releases/download/${VERSION}/checksums.txt
sha256sum --ignore-missing -c checksums.txt

tar xzf ${ARCHIVE}
./prepalert-agent --version
```

Or build from source:

```bash
bun install
bun run compile
```

A Docker image is also available:

```bash
docker pull ghcr.io/mashiike/prepalert-agent
```

## Usage

```
Usage: prepalert-agent [options] [command]

Alert response agent powered by Claude Agent SDK

Options:
  -v, --version            output the version number
  --project-dir <dir>      path to the alert response project directory (default: ".")
  --log-level <level>      log level: debug, info, warn, error (default: "info")
  -h, --help               display help for command

Commands:
  run [options]            Execute a runbook (interactive or headless with -p)
  serve [options]          Start a webhook server
  init                     Initialize a new alert response project
  skills                   Manage skills (list/install/update/uninstall/status)
  docs                     Show documentation
  help [command]           display help for command
```

### `run`

Execute runbooks for alert investigation. Runs in interactive mode by default, or headless mode with `-p`.

```bash
# Interactive mode
prepalert-agent run

# Headless mode with prompt
prepalert-agent run -p "Investigate the 5xx error rate spike"

# Pipe alert payload
cat alerts/web-api-5xx.json | prepalert-agent run -p -
```

### `serve`

Start a webhook server that receives alert notifications and runs the appropriate runbooks.

```bash
prepalert-agent serve
prepalert-agent serve --port 9090
prepalert-agent --project-dir ./my-project serve
```

Features:
- **Authentication**: None, Basic, or OIDC (JWT) per webhook endpoint
- **SPA**: Session viewer (browse reports, artifacts, and transcripts)
- **OIDC authentication**: Protect the SPA and API with Google / Auth0 etc.
- **Async mode** (default): Returns 202 immediately, agent runs in background
- **Sync mode**: Waits for agent completion, returns 200 (for Cloud Run etc.)
- **ECS task protection**: Automatically protects tasks during async processing
- **External queue dispatch**: Cloud Tasks / AWS SQS

## Project Structure

```
my-project/
├── prepalert.yaml          # Project config + agent instructions
├── .mcp.json               # MCP server definitions (same format as Claude Code)
├── references/             # Static reference documents for the agent
│   └── service-map.md
├── runbooks/               # Investigation procedures
│   └── web-api/
│       └── 5xx-rate-over-limit.md
├── logs/                   # Operation logs (auto-generated, add to .gitignore)
│   └── {timestamp}-{id}.jsonl
└── sessions/               # Session records (auto-generated, add to .gitignore)
    └── YYYY/MM/DD/{session-id}/   # date-partitioned
        ├── metadata.json
        ├── transcript.jsonl
        ├── report.md
        └── artifacts/
```

### `prepalert.yaml`

String values support bash-style environment variable expansion:

| Syntax | Behavior |
|---|---|
| `${VAR}` | Expand value; error if unset |
| `${VAR:-default}` | Use `default` if unset or empty |
| `${VAR-default}` | Use `default` if unset |
| `${VAR:+alt}` | Use `alt` if set and non-empty |
| `${VAR:?message}` | Error with `message` if unset or empty |

```yaml
name: my-web-api-monitoring
model: sonnet
maxTurns: 10
costLimit: 1.0
timeout: 15m

serve:
  webhooks:
    - path: /webhook/mackerel
      authType: basic
      username: ${MACKEREL_WEBHOOK_USER}
      password: ${MACKEREL_WEBHOOK_PASS}
      headerPrompt: ${HEADER_PROMPT:-The following alert has been received:}

instructions: |
  This project monitors a web API running on ECS.
  Write investigation results in Japanese.
```

### Runbooks

Runbooks are Markdown files with YAML frontmatter. The agent selects and executes them based on alert content.

```markdown
---
description: Investigate 5xx errors using CloudWatch Logs
trigger: When 5xx error rate exceeds threshold
---

1. Check Mackerel for alert details and identify the service
2. Use aws-mcp to check CloudWatch Logs for the target service
```

Runbook ID is derived from the file path: `runbooks/web-api/5xx-rate-over-limit.md` → `web-api/5xx-rate-over-limit`

## Observability (OpenTelemetry)

prepalert-agent supports exporting logs, metrics, and traces via OpenTelemetry (OTLP/HTTP).

### Enabling

Set the standard OTel environment variable to activate:

```bash
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
prepalert-agent run -p "Investigate the alert"
```

Without `OTEL_EXPORTER_OTLP_ENDPOINT`, telemetry is completely disabled (zero overhead). Set `OTEL_SDK_DISABLED=true` to explicitly disable even when the endpoint is configured.

### What is exported

**Traces** — hierarchical spans per session:

```
session (session.id, session.cost_usd)
├── turn-1 (turn.number, turn.cost_usd, turn.input_tokens, turn.output_tokens)
│   ├── tool/Bash (tool.id, tool.name)
│   └── tool/Read (tool.id, tool.name)
└── turn-2
    └── tool/Agent (tool.id, tool.name)
```

**Metrics:**

| Name | Type | Description |
|---|---|---|
| `prepalert.session.cost_usd` | Histogram | Total cost in USD per session |
| `prepalert.session.turns` | Counter | Total number of turns |
| `prepalert.session.input_tokens` | Counter | Total input tokens consumed |
| `prepalert.session.output_tokens` | Counter | Total output tokens consumed |

**Logs** — all structured log records (same content as local JSONL files) are forwarded via OTLP.

### Configuration

All configuration uses [standard OpenTelemetry environment variables](https://opentelemetry.io/docs/specs/otel/protocol/exporter/):

| Variable | Description |
|---|---|
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Collector endpoint (e.g. `http://localhost:4318`) |
| `OTEL_EXPORTER_OTLP_HEADERS` | Auth headers (e.g. `api-key=xxx`) |
| `OTEL_SDK_DISABLED` | Set `true` to disable |
| `OTEL_SERVICE_NAME` | Override service name (default: `prepalert-agent`) |
| `OTEL_RESOURCE_ATTRIBUTES` | Additional resource attributes (e.g. `deployment.environment=production,service.instance.id=abc`) |

Host and process attributes (`host.name`, `process.pid`, `process.runtime.*`) are auto-detected. See [docs/spec/en/telemetry.md](docs/spec/en/telemetry.md) for details.

## Spec Documents

| Document | Content |
|---|---|
| [project-config.md](docs/spec/en/project-config.md) | All project config fields |
| [runbook.md](docs/spec/en/runbook.md) | How to write runbooks |
| [auth.md](docs/spec/en/auth.md) | OIDC authentication setup |
| [export-and-handoff.md](docs/spec/en/export-and-handoff.md) | Session export and handoff |
| [project-structure.md](docs/spec/en/project-structure.md) | Project structure details |
| [telemetry.md](docs/spec/en/telemetry.md) | OpenTelemetry details |
| [init.md](docs/spec/en/init.md) | `init` command spec |
| [install-skills.md](docs/spec/en/install-skills.md) | `skills` command spec |
| [deployment.md](docs/spec/en/deployment.md) | Deployment guide (ECS / Cloud Run / Lambda etc.) |

## Development

### Prerequisites

- [Bun](https://bun.sh/) >= 1.3
- [Node.js](https://nodejs.org/) >= 26 (managed via [asdf](https://asdf-vm.com/))

### Setup

```bash
asdf install
bun install
```

### Commands

```bash
bun run dev          # Development with hot reload
bun run build        # TypeScript compilation
bun run compile      # Build standalone binary
bun test             # Run tests
```

## License

MIT License. See [LICENSE](LICENSE) for details.
