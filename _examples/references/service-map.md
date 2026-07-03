# acme-api Service Map

## Components

| Component | Technology | Notes |
|---|---|---|
| API server | Go (net/http) on Amazon ECS (Fargate) | Service: `acme-api`, roles: `api-server` |
| Background worker | Go on Amazon ECS (Fargate) | Same task definition family, role: `worker` |
| Database | Amazon RDS (PostgreSQL) | Primary + 1 read replica |
| Cache | Amazon ElastiCache (Redis) | Single node, no cluster mode |
| Logs | CloudWatch Logs | Log group: `/ecs/acme-api`, structured JSON |
| Metrics/Alerts | Mackerel | Service: `acme-api` |

## Request Flow

```
client -> ALB -> ECS (api-server) -> RDS (PostgreSQL)
                                   -> ElastiCache (Redis)
```

Background jobs (email delivery, report generation) are processed asynchronously by the `worker` role, which reads from the same RDS instance and does not receive inbound traffic.

## Known Dependencies

- `api-server` fails health checks if RDS is unreachable for more than 5 seconds
- `api-server` degrades gracefully (serves stale data) if Redis is unreachable
- `worker` retries failed jobs up to 3 times before moving them to a dead-letter queue
