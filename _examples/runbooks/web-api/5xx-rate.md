---
description: Triage runbook for 5xx error rate alerts. Checks alert details and recent error logs.
trigger: When 5xx error rate exceeds threshold
model: haiku
effort: low
maxTurns: 5
costLimit: 0.10
allowedTools:
  - mcp__mackerel__*
  - mcp__aws__*
---

1. Retrieve alert details from Mackerel to identify the affected service and the metric that triggered the alert
2. Query CloudWatch Logs (log group: /ecs/acme-api) for recent ERROR-level entries around the alert time
3. Summarize: which endpoints are failing, error frequency, and any common error patterns
