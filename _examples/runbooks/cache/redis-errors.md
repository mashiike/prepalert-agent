---
description: Investigate Redis cache errors or high latency.
trigger: When ElastiCache error rate increases or cache hit ratio drops significantly
model: haiku
effort: low
maxTurns: 5
costLimit: 0.10
allowedTools:
  - mcp__mackerel__*
  - mcp__aws__*
---

1. Check Mackerel for cache-related alerts and metrics
2. Query CloudWatch for ElastiCache metrics: CurrConnections, CacheHitRate, EngineCPUUtilization, Evictions, ReplicationLag
3. Query CloudWatch Logs for Redis connection errors (keywords: "READONLY", "CLUSTERDOWN", "connection reset", "redis timeout")
4. Summarize: cache status, error patterns, and whether the issue is capacity, network, or failover related
