---
description: Triage runbook for API latency spike alerts. Checks metrics and recent slow requests.
trigger: When API response latency p99 exceeds threshold
model: haiku
effort: low
maxTurns: 5
costLimit: 0.10
allowedTools:
  - mcp__mackerel__*
  - mcp__aws__*
---

1. Retrieve alert details from Mackerel to confirm which latency metric triggered
2. Check Mackerel host metrics for the api-server role to see CPU, memory, and request counts
3. Query CloudWatch Logs for requests with high response times (look for duration_ms or latency fields in structured logs)
4. Summarize: affected endpoints, latency distribution, and potential bottleneck (CPU, DB, cache, or external call)
