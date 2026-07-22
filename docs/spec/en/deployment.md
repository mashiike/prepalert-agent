# Deployment Guide

## API Providers

prepalert-agent uses the [Claude Agent SDK](https://github.com/anthropics/claude-agent-sdk-typescript) and supports the following API providers.

| Provider | Description |
|---|---|
| Anthropic API (direct) | Authenticated via `ANTHROPIC_API_KEY` |
| Amazon Bedrock | Authenticated via AWS credentials (IAM role / access keys) |
| Google Vertex AI | Authenticated via Google Cloud ADC (Application Default Credentials) |

For provider configuration details (environment variables, authentication, model name specification), refer to the official Claude Agent SDK and Claude Code documentation.

- [Claude Agent SDK](https://github.com/anthropics/claude-agent-sdk-typescript)
- [Claude Code - API Provider Configuration](https://docs.anthropic.com/en/docs/claude-code)

prepalert-agent inherits the SDK's configuration as-is, so any provider configuration that works with Claude Code will work here.

## Container Image

Official container images are provided via ghcr.io.

```bash
docker pull ghcr.io/mashiike/prepalert-agent:latest
docker pull ghcr.io/mashiike/prepalert-agent:0.1.0
```

- Base image: `node:26-slim`
- Architectures: `linux/amd64`, `linux/arm64`
- Includes `uv` / `uvx` for Python tool support

### Custom Images

To add MCP server dependencies (Python packages, etc.):

```dockerfile
FROM ghcr.io/mashiike/prepalert-agent:latest

RUN uvx install awscli
# or
RUN pip install some-mcp-server
```

## Deployment Architecture Examples

### ECS Fargate

The simplest deployment. Async mode + ECS task protection prevents task termination during agent execution.

```
[Mackerel] --webhook--> [ALB] --> [ECS Fargate]
                                    prepalert-agent serve
```

**prepalert.yaml:**

```yaml
name: my-monitoring
model: sonnet
timeout: 15m

serve:
  webhooks:
    - path: /webhook/mackerel
      authType: basic
      username: ${WEBHOOK_USER}
      password: ${WEBHOOK_PASS}
```

**Required IAM permissions:**

- Task role: `ecs:UpdateTaskProtection` (required for task protection)
- API provider credentials (for Bedrock: `bedrock:InvokeModel`)

**Key points:**

- `ecsTaskProtection: auto` (default) automatically enables task protection when `ECS_AGENT_URI` is detected
- Async mode (default) means you don't need to worry about ALB idle timeout
- Set `timeout` shorter than the ECS task's `stopTimeout`

### Cloud Run + Cloud Tasks

Suitable when execution may exceed Cloud Run's maximum request timeout (60 minutes), or when the alert source has a short timeout.

```
[Mackerel] --webhook--> [Cloud Run] --enqueue--> [Cloud Tasks]
                              ^                        |
                              |      callback          |
                              +------------------------+
```

**Two-endpoint pattern:**

```yaml
name: my-monitoring
model: sonnet
timeout: 15m

serve:
  webhooks:
    - path: /webhook/mackerel
      authType: basic
      username: ${WEBHOOK_USER}
      password: ${WEBHOOK_PASS}
      dispatch:
        type: cloud-tasks
        queue: ${CLOUD_TASKS_QUEUE}
        targetPath: /internal/process
        oidc:
          audience: ${CLOUD_RUN_URL}
    - path: /internal/process
      authType: oidc
      issuer: https://accounts.google.com
      audience: ${CLOUD_RUN_URL}
      sync: true
```

**Single-path pattern:**

```yaml
serve:
  webhooks:
    - path: /webhook/mackerel
      authType: oidc
      issuer: https://accounts.google.com
      audience: ${CLOUD_RUN_URL}
      sync: true
      dispatch:
        type: cloud-tasks
        queue: ${CLOUD_TASKS_QUEUE}
```

**Required IAM permissions:**

- Cloud Run service account: `cloudtasks.tasks.create`
- Cloud Tasks service account: `run.routes.invoke` (for callbacks)
- API provider credentials (for Vertex AI: `aiplatform.endpoints.predict`)

**Key points:**

- Set `dispatch.dispatchDeadline` (default Cloud Tasks deadline of 10 minutes may be too short)
- Setting Cloud Run max concurrent requests to 1 prevents resource contention during agent execution
- The two-endpoint pattern allows using basic auth for ingestion and OIDC for processing

### Lambda + API Gateway + SQS

Subject to Lambda cold start and maximum execution time (15 minutes) constraints. Suitable for short investigations.

```
[Mackerel] --webhook--> [API Gateway] --> [Lambda]
                                            |
                                            v (for long-running)
                                          [SQS] --> [Lambda]
```

**prepalert.yaml:**

```yaml
name: my-monitoring
model: sonnet
timeout: 14m

serve:
  webhooks:
    - path: /webhook/mackerel
      authType: basic
      username: ${WEBHOOK_USER}
      password: ${WEBHOOK_PASS}
      dispatch:
        type: aws-sqs
        queueUrl: ${SQS_QUEUE_URL}
        targetPath: /internal/process
    - path: /internal/process
      authType: none
      sync: true
```

**Key points:**

- Lambda maximum execution time is 15 minutes. Set `timeout` shorter than this
- **`sessionsDir` and `logsDir` automatically fall back to `/tmp` (`/tmp/prepalert-sessions` and `/tmp/prepalert-logs` respectively) on Lambda.** On Lambda the filesystem is read-only except for `/tmp`. When a non-`/tmp` path is configured, a warning is logged and it falls back. To silence the warning, set both explicitly under `/tmp`. Note that writes to `sessionsDir` happen even when `storage` (S3) is configured
- **The project directory itself is also copied to `/tmp/prepalert-project` automatically on startup in a Lambda environment.** The Claude Agent SDK creates scratch files relative to `cwd` (the project directory), which fails when the project directory is baked read-only into a container image
- Set SQS `VisibilityTimeout` to be greater than or equal to `timeout`
- In Lambda environments, async mode is automatically forced to sync mode (Lambda does not support fire-and-forget execution)
- Use API Gateway v2 (HTTP API) — SQS dispatch sends events in v2 format
- Enable **`ReportBatchItemFailures`** in the Lambda event source mapping. prepalert-agent returns only failed records as `batchItemFailures` (partial batch response). Without this setting, a single failure causes the entire batch to be redelivered, resulting in duplicate execution

### Bedrock AgentCore Runtime

AgentCore Runtime executes agents on microVMs. Requires `GET /ping` health checks and `POST /invocations` for request handling.

```
[AgentCore Runtime] --> [microVM]
                          prepalert-agent serve
```

**prepalert.yaml:**

```yaml
name: my-monitoring
model: sonnet
timeout: 15m

serve:
  healthCheck:
    path: /ping
    idle:
      body: '{"status":"Healthy","time_of_last_update":@unix_time}'
    busy:
      body: '{"status":"HealthyBusy","time_of_last_update":@unix_time}'
  webhooks:
    - path: /invocations
      authType: none
      sync: true
```

**Key points:**

- Returning `HealthyBusy` suppresses automatic microVM termination
- `@unix_time` is dynamically expanded, always returning the latest timestamp
- `authType: none` is acceptable (the network within AgentCore Runtime is isolated)
- The API provider is automatically configured by AgentCore Runtime

## SPA and OIDC Authentication

The `serve` command includes a built-in session viewer SPA. Configure OIDC authentication when exposing externally.

**Without `serve.auth`, the SPA and `/api/*` respond unauthenticated.** This configuration assumes access is blocked or authenticated upstream (CloudFront, ALB, etc.), or that the server is only reachable within a trusted network. Exposing it to the internet without meeting this assumption makes sessions (alert investigation results, logs, artifacts) readable by anyone.

```yaml
serve:
  baseUrl: https://prepalert.example.com
  sessionSecret: ${SESSION_SECRET}
  exportSecret: ${EXPORT_SECRET}
  auth:
    issuer: https://accounts.google.com
    clientId: ${GOOGLE_CLIENT_ID}
    clientSecret: ${GOOGLE_CLIENT_SECRET}
    allowedDomains:
      - example.com
```

- `baseUrl` is used to construct the OAuth callback URL. Explicit configuration is recommended in reverse proxy environments
- Without `sessionSecret` / `exportSecret`, sessions and export URLs are invalidated on server restart
- OIDC session authentication is not applied to webhook paths (controlled by webhook-specific `authType`)

See [auth.md](./auth.md) for details.

## Persistent Storage

Configure `storage` to persist session data across server restarts.

```yaml
storage: s3://my-bucket/prepalert/
storageOptions:
  region: ap-northeast-1
```

- Supports S3 or GCS (`s3://` / `gs://`)
- S3-compatible storage (MinIO, etc.) is supported via `storageOptions.endpoint` and `forcePathStyle`
- **GCS (`gs://`) is accessed via the S3-compatible XML API with SigV4, so you must provide a GCS interoperability HMAC key as `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`** (GCP native authentication does not work). See `storage` in [project-config.md](./project-config.md) for details
- `sessionsDir` is always used as a local buffer. `storage` is the async upload destination

See [project-config.md](./project-config.md) for `storage` / `storageOptions` details.
