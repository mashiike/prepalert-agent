---
description: Investigate database connection pool exhaustion or high connection count.
trigger: When RDS connection count approaches the limit or application logs connection timeout errors
model: sonnet
effort: medium
maxTurns: 10
costLimit: 0.30
allowedTools:
  - mcp__mackerel__*
  - mcp__aws__*
---

1. Check Mackerel alerts for database-related metrics
2. Query CloudWatch for RDS metrics: DatabaseConnections, CPUUtilization, FreeableMemory, ReadLatency, WriteLatency
3. Query CloudWatch Logs for connection-related errors (keywords: "connection refused", "too many connections", "connection timeout", "pool exhausted")
4. Check if recent deployments or traffic spikes correlate with the connection increase
5. Summarize: current connection count vs limit, error patterns, and whether the issue is a connection leak, traffic spike, or slow queries holding connections
