# Runbook Template

Template for runbook files. Replace `{...}` placeholders with target app information.

## Basic Structure

```markdown
---
description: {What this runbook does}
trigger: {What alert condition triggers this runbook}
model: {haiku | sonnet | opus}
effort: {low | medium | high}
maxTurns: {Guideline: triage 5, deep investigation 15}
costLimit: {0.10-0.50}
allowedTools:
  - {MCP tool wildcards needed}
---

{Numbered investigation steps}
```

## Type-specific Templates

### Triage (initial investigation)

```markdown
---
description: Initial investigation for {failure surface}
trigger: When "{alert condition in natural language}"
model: haiku
effort: low
maxTurns: 5
costLimit: 0.10
allowedTools:
  - mcp__{monitoring-service}__*
  - mcp__{logging/infra-service}__*
---

1. Retrieve alert details from {monitoring service}
2. {Log/metrics check procedure}
3. Identify blast radius and summarize findings
```

### Deep Investigation

```markdown
---
description: Detailed investigation for {failure surface}
trigger: {Escalation condition after triage}
model: sonnet
effort: medium
maxTurns: 15
costLimit: 0.50
# For complex investigations, consider model: opus, effort: high
allowedTools:
  - mcp__{monitoring-service}__*
  - mcp__{logging/infra-service}__*
---

1. {Retrieve alert information}
2. {Check related metrics time series}
3. {Detailed log investigation, error pattern analysis}
4. {Check related external dependency status}
5. {Summarize root cause hypothesis and blast radius}
```

## allowedTools Configuration Guide

Specify only the tools actually used in the runbook.

Common monitoring and observability MCP servers:

| MCP Server | Wildcard | Purpose |
|---|---|---|
| Grafana (mcp-grafana) | `mcp__grafana__*` | Dashboards, Loki logs, Prometheus metrics, alerts, incidents |
| Mackerel | `mcp__mackerel__*` | Alert info, metrics, host info |
| Datadog | `mcp__datadog__*` | Metrics, logs, traces, monitors |
| Sentry | `mcp__sentry__*` | Error tracking, issue analysis |
| PagerDuty | `mcp__pagerduty__*` | Incident management, on-call info |
| AWS | `mcp__aws__*` | CloudWatch Logs, ECS, RDS, Lambda, etc. |
| GCP (gcloud) | `mcp__gcloud__*` | Cloud Logging, Cloud Monitoring, GKE, etc. |
| Azure | `mcp__azure__*` | Azure Monitor, Container Apps, etc. |

Adjust wildcards to match the actual server names configured in `.mcp.json`.

**Note:** Runbooks may execute in serve mode (webhook containers) which typically do not have access to the application source code. Design investigation steps so they work with MCP tools alone. The agent can opportunistically use `Read`/`Grep` when the codebase is available, but runbook steps should not depend on it.

## File Layout Guide

Organize by failure surface category using subdirectories.

```
runbooks/
├── web-api/           # HTTP endpoint related
│   ├── 5xx-rate.md
│   └── latency.md
├── database/          # DB related
│   └── connection-pool.md
└── worker/            # Background job related
    └── queue-depth.md
```
