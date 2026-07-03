# Example Project: acme-api

This is a sample prepalert-agent project for a fictional REST API called "acme-api".

## Fictional Architecture

**acme-api** is a Go REST API that provides a backend for a web application.

- **Runtime:** Go (net/http)
- **Deployment:** Amazon ECS (Fargate)
- **Database:** Amazon RDS (PostgreSQL)
- **Cache:** Amazon ElastiCache (Redis)
- **Logging:** CloudWatch Logs (`/ecs/acme-api`, structured JSON)
- **Monitoring:** Mackerel (service: `acme-api`, roles: `api-server`, `worker`)

## Directory Structure

```
_examples/
├── README.md              # This file
├── prepalert.yaml         # Project configuration + instructions
├── .mcp.json              # MCP server configuration (Mackerel + AWS)
├── .gitignore             # Excludes logs/ and sessions/
├── references/
│   └── service-map.md     # Static service map read by the agent
└── runbooks/
    ├── web-api/
    │   ├── 5xx-rate.md    # Triage: 5xx error rate spike
    │   └── latency.md     # Triage: API latency spike
    ├── database/
    │   └── connection-pool.md  # Investigation: DB connection exhaustion
    └── cache/
        └── redis-errors.md     # Triage: Redis cache errors
```

## Runbook Design

Each runbook is designed to work **without access to the application source code** — all investigation steps use MCP tools (Mackerel for alert/metrics, AWS for CloudWatch Logs and resource metrics).

| Runbook | Type | Model | Cost Limit | Failure Surface |
|---|---|---|---|---|
| `web-api/5xx-rate.md` | Triage | haiku | $0.10 | HTTP 5xx error rate |
| `web-api/latency.md` | Triage | haiku | $0.10 | API response latency |
| `database/connection-pool.md` | Investigation | sonnet | $0.30 | DB connection pool |
| `cache/redis-errors.md` | Triage | haiku | $0.10 | Redis cache errors |

## Try It

```bash
# Run interactively (requires ANTHROPIC_API_KEY and MACKEREL_APIKEY)
prepalert-agent run --project-dir _examples

# Run with a test prompt
prepalert-agent run --project-dir _examples -p "5xx error rate spiked to 8% on acme-api"

# Start webhook server
WEBHOOK_USER=admin WEBHOOK_PASS=secret prepalert-agent serve --project-dir _examples
```
