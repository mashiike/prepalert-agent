# Project Configuration (`prepalert.yaml`)

A configuration file placed at the project root. Controls the overall behavior of the Agent.

### Environment Variable Expansion

`${VAR_NAME}` within string values is expanded using environment variables. Bash-compatible variable expansion syntax is supported.

| Syntax | Behavior |
|---|---|
| `${VAR}` | Expands to the value. Errors if unset |
| `${VAR:-default}` | Uses `default` if unset or empty string |
| `${VAR-default}` | Uses `default` if unset (empty string is expanded as-is) |
| `${VAR:+alternate}` | Uses `alternate` if set and non-empty, otherwise empty string |
| `${VAR+alternate}` | Uses `alternate` if set, empty string if unset |
| `${VAR:?message}` | Errors if unset or empty string (custom message can be specified) |
| `${VAR?message}` | Errors if unset (empty string is allowed) |

Syntax with `:` targets "unset **or** empty string", while syntax without `:` targets "unset only".

```yaml
# Example
serve:
  webhooks:
    - path: /webhook
      username: ${WEBHOOK_USER}
      password: ${WEBHOOK_PASS}
      headerPrompt: ${HEADER_PROMPT:-The following alert has been received:}
```

Environment variable expansion is performed **statically** once at configuration load time. No dynamic expansion occurs per request.

## File Structure

```yaml
name: <string>                        # Project name (required)
model: <string>                       # Model used by the Agent (optional)
effort: <string>                      # Agent reasoning effort level (optional)
runbooksDir: <string>                 # Path to the runbook directory (optional, default: "runbooks")
logsDir: <string>                     # Directory for operational logs (optional, default: "logs")
sessionsDir: <string>                 # Directory for session records (optional, default: "sessions")
storage: <string>                     # Persistent storage URL (optional, e.g. "s3://bucket/prefix/", "gs://bucket/prefix/")
storageOptions:                       # Options for S3-compatible storage (optional)
  endpoint: <string>                  # Custom endpoint (MinIO, Sakura, etc.)
  forcePathStyle: <boolean>           # Path-style access (required for MinIO, etc.)
  region: <string>                    # Region
maxTurns: <number>                    # Maximum number of Agent turns (optional, default: 10)
costLimit: <number>                   # Cost limit per execution in USD (optional)
timeout: <string>                     # Execution timeout (optional, e.g. "15m", "1h")
mcpConfig: <string>                   # Path to .mcp.json (optional, default: ".mcp.json")
allowedTools: <string[]>              # Allowed tools (optional)
disallowedTools: <string[]>           # Disallowed tools (optional)
settingSources: <string[]>            # SDK setting load sources (optional, default: ["project", "local"])

instructions: |                       # Common instructions for the Agent (optional, mutually exclusive with instructionsFile)
  Free-form text.
instructionsFile: <string>            # Load instructions from an external file (optional, mutually exclusive with instructions)

serve:                                # serve command settings (optional)
  port: <number>                      # Port number (optional, default: 8080)
  syncMode: <boolean>                 # Default sync mode for webhooks (optional, default: false)
  ecsTaskProtection: <string>         # Default ECS task protection for webhooks (optional, "auto" | "off", default: "auto")
  exportSecret: <string>              # JWT signing key for export URLs (optional, auto-generated if unset)
  sessionSecret: <string>             # JWT signing key for session cookies (optional, recommended when using auth)
  baseUrl: <string>                   # External public URL (optional, inferred from request headers if unset)
  staticDir: <string>                 # Frontend static file directory (optional, uses built-in SPA if unset)
  auth:                               # OIDC authentication settings (optional, enables authentication for SPA + API when set)
    issuer: <string>                  # OIDC issuer URL (required)
    clientId: <string>                # OAuth client ID (required)
    clientSecret: <string>            # OAuth client secret (required)
    allowedDomains: <string[]>        # Allowed email domains (optional, all users allowed if unset)
  healthCheck:                        # Health check settings (optional)
    path: <string>                    # Endpoint path (optional, default: "/health")
    contentType: <string>             # Content-Type header (optional, default: "application/json")
    idle:                             # When activeRequests == 0 (optional)
      status: <number>                # HTTP status code (optional, default: 200)
      body: <string | { sh: string }> # Response body (optional, supports dynamic variable expansion)
    busy:                             # When activeRequests > 0 (optional)
      status: <number>                # HTTP status code (optional, default: 200)
      body: <string | { sh: string }> # Response body (optional, supports dynamic variable expansion)
  webhooks:                           # Webhook endpoints (optional)
    - path: <string>
      authType: <string>              # "none" | "basic" | "oidc"
      headerPrompt: <string>          # Prompt header prepended to webhook body (optional)
      sync: <boolean>                 # Sync mode (optional, default: serve.syncMode)
      ecsTaskProtection: <string>     # ECS task protection (optional, default: serve.ecsTaskProtection)
      username: <string>              # For basic auth
      password: <string>              # For basic auth
      issuer: <string>                # For oidc
      audience: <string>              # For oidc
      jwksUri: <string>               # For oidc (optional)
      dispatch:                       # External queue forwarding settings (optional)
        type: <string>                # "cloud-tasks" (discriminated union)
        queue: <string>               # Cloud Tasks queue resource name (required)
        targetPath: <string>          # Forwarding target path (optional, defaults to self)
        baseUrl: <string>             # Base URL for task delivery (optional, constructed from request Host)
        dispatchDeadline: <string>    # Task execution deadline (optional, default: project timeout)
        oidc:                         # OIDC authentication for Cloud Tasks -> target (optional)
          serviceAccountEmail: <string>  # optional, retrieved from metadata server
          audience: <string>          # optional, default: baseUrl
```

## Fields

### `name`

- **Type:** `string`
- **Required:** Yes
- **Description:** Project name. Used in log output and identification.

### `model`

- **Type:** `string`
- **Required:** No
- **Default:** Agent SDK's default model
- **Description:** The Claude model name used by the Agent. `sonnet`, `opus`, `haiku`, etc. Can be overridden per runbook.

### `effort`

- **Type:** `"low"` | `"medium"` | `"high"` | `"xhigh"` | `"max"`
- **Required:** No
- **Default:** Agent SDK's default
- **Description:** The Agent's reasoning effort level. Allows switching between "shallow and fast" and "deep and thorough" with the same model. Can be overridden per runbook.

### `runbooksDir`

- **Type:** `string`
- **Required:** No
- **Default:** `"runbooks"`
- **Description:** Path to the directory containing runbook files. Relative to the project root.

### `logsDir`

- **Type:** `string`
- **Required:** No
- **Default:** `"logs"`
- **Description:** Path to the directory for storing operational logs. Relative to the project root. One file per process is created in JSON Lines format. Recommended to add to `.gitignore`.

### `sessionsDir`

- **Type:** `string`
- **Required:** No
- **Default:** `"sessions"`
- **Description:** Path to the local directory for storing Agent execution session records. Relative to the project root. Stored in a date-partitioned structure (`YYYY/MM/DD/{session-id}/`). Recommended to add to `.gitignore`. Even when `storage` is configured, data is always written here (local buffer).

### `storage`

- **Type:** `string`
- **Required:** No
- **Default:** None (when unset, `sessionsDir` serves as the persistent destination)
- **Description:** Persistent storage URL. Format: `s3://bucket/prefix/` or `gs://bucket/prefix/`. When configured, session data (report, artifact, metadata) is written immediately, and the transcript is uploaded upon session completion. The API reads from this location.

### `storageOptions`

- **Type:** `object`
- **Required:** No
- **Description:** Options for S3-compatible storage. Used with MinIO, Sakura storage, etc.

| Field | Type | Description |
|---|---|---|
| `endpoint` | `string` | Custom endpoint URL |
| `forcePathStyle` | `boolean` | Use path-style access (required for MinIO, etc.) |
| `region` | `string` | Region |

### `maxTurns`

- **Type:** `number`
- **Required:** No
- **Default:** `10`
- **Description:** Maximum number of Agent turns. The upper limit for the number of tool call and response exchanges. Can be overridden per runbook.

### `costLimit`

- **Type:** `number`
- **Required:** No
- **Description:** Cost limit per execution in USD. The Agent stops execution when this amount is reached. Can be overridden per runbook.

### `timeout`

- **Type:** `string`
- **Required:** No
- **Description:** Timeout per execution. Specified in duration format such as `30s`, `15m`, `1h`. The Agent is interrupted when the timeout is reached. Only applies in headless mode (`-p` / `serve`). In interactive mode, the user controls the session lifetime.

### `mcpConfig`

- **Type:** `string`
- **Required:** No
- **Default:** `".mcp.json"`
- **Description:** Path to the MCP server configuration file. Relative to the project root. Specify the path when you want to share Claude Code's `.mcp.json`. Example: `mcpConfig: "../.mcp.json"`

### `allowedTools`

- **Type:** `string[]`
- **Required:** No
- **Default:** In headless mode: `["Read", "Glob", "Grep", "WebSearch", "WebFetch", "Agent"]` + wildcards for all MCP servers (`mcp__<server>__*`). In interactive mode: unset (follows permission mode)
- **Description:** List of tools auto-approved without permission prompts. Supports glob patterns. Example: `["mcp__mackerel__*", "Read"]`. In headless mode, used in combination with `dontAsk` mode, where only tools listed here can be executed.
- **Note:** This is the parent Agent's permission setting. The `allowedTools` of a runbook sub-agent (`tools` in AgentDefinition) is a visibility restriction on what tools the sub-agent can use, while permission auto-approve is governed by the parent's settings. See "Relationship Between Permissions and Sub-agents" for details.

### `disallowedTools`

- **Type:** `string[]`
- **Required:** No
- **Description:** List of disallowed tools. Takes priority over `allowedTools`. Applied even in `bypassPermissions` mode. Scoped patterns (e.g., `Bash(rm *)`) can also be used. Example: `["Bash(rm *)", "Edit"]`.

### `settingSources`

- **Type:** `string[]`
- **Required:** No
- **Default:** `["project", "local"]`
- **Description:** Sources from which the Claude Agent SDK loads settings. Available values: `"user"` (`~/.claude/settings.json`), `"project"` (`.claude/settings.json`), `"local"` (`.claude/settings.local.json`). By default, `user` is not included, so personal Claude Code settings (MCP servers, etc.) are not loaded. To inherit your organization's Claude Code settings, specify `["user", "project", "local"]`.

### `instructions`

- **Type:** `string` (YAML block scalar)
- **Required:** No
- **Description:** Instruction text included in the Agent's system prompt for all runbook executions. Setting this simultaneously with `instructionsFile` results in an error.

### `instructionsFile`

- **Type:** `string`
- **Required:** No
- **Description:** Loads common instructions for the Agent from an external file. Relative to the project root. Setting this simultaneously with `instructions` results in an error. Example: `instructionsFile: PREPALERT.md`

### `serve`

Settings specific to the `serve` command.

#### `serve.port`

- **Type:** `number`
- **Required:** No
- **Default:** `8080`
- **Description:** Port number used by the `serve` command. Can be overridden with the `--port` CLI option.

#### `serve.syncMode`

- **Type:** `boolean`
- **Required:** No
- **Default:** `false`
- **Description:** Default value for each webhook's `sync` field. Can be individually overridden per webhook. When `true`, the webhook handler waits for the Agent execution to complete before returning 200 OK. When `false`, it immediately returns 202 Accepted and the Agent runs in the background.

#### `serve.ecsTaskProtection`

- **Type:** `"auto"` | `"off"`
- **Required:** No
- **Default:** `"auto"`
- **Description:** Default value for each webhook's `ecsTaskProtection` field. Can be individually overridden per webhook. When `auto`, task protection is automatically enabled during webhook processing if in async mode (`sync: false`) and the `ECS_AGENT_URI` environment variable exists. When `sync: true`, protection is not applied regardless of this setting. The task role requires the `ecs:UpdateTaskProtection` permission.

#### `serve.exportSecret`

- **Type:** `string`
- **Required:** No
- **Description:** Secret key used for JWT signing of export URLs. When unset, a random key is generated at server startup (existing export URLs become invalid on restart). In production, set this via environment variables.

#### `serve.sessionSecret`

- **Type:** `string`
- **Required:** No (recommended when using `auth`)
- **Description:** JWT signing key for session cookies. Separate from `exportSecret`. When unset, a random key is generated (all users must re-login on restart).

#### `serve.baseUrl`

- **Type:** `string`
- **Required:** No
- **Description:** External public URL (e.g., `https://prepalert.example.com`). Used to construct export URLs and OAuth redirect URIs. When unset, it is automatically inferred from request headers (`X-Forwarded-Host`, etc.). Explicit configuration is recommended in production.

#### `serve.staticDir`

- **Type:** `string`
- **Required:** No
- **Description:** Frontend static file directory. Relative to the project root. When unset, the built-in SPA is used. Specify the build output directory when using a custom frontend.

#### `serve.auth`

OIDC authentication settings. When configured, authentication is applied to the SPA (`/`, `/sessions/*`) and API (`/api/*`). When unset, no authentication is applied.
See [auth.md](./auth.md) for details.

| Field | Type | Required | Description |
|---|---|---|---|
| `issuer` | `string` | Yes | OIDC issuer URL |
| `clientId` | `string` | Yes | OAuth client ID |
| `clientSecret` | `string` | Yes | OAuth client secret |
| `allowedDomains` | `string[]` | No | Allowed email domains. All users are allowed if unset |

#### `serve.healthCheck`

Health check endpoint settings. Automatically enabled when the `serve` command starts. Authentication is not applied (always public).

When unset, the following default behavior applies:

- **Path:** `GET /health`
- **idle:** `200 {"status":"idle","activeRequests":0}`
- **busy:** `200 {"status":"busy","activeRequests":<N>}`

#### `serve.healthCheck.path`

- **Type:** `string`
- **Required:** No
- **Default:** `"/health"`
- **Description:** Path for the health check endpoint. Responds to the `GET` method. An error occurs if it overlaps with a webhook path. Paths starting with `/`, `/index.html`, or `/api/` are reserved and cannot be used.

#### `serve.healthCheck.contentType`

- **Type:** `string`
- **Required:** No
- **Default:** `"application/json"`
- **Description:** `Content-Type` header for the response.

#### `serve.healthCheck.idle`

Response settings when `activeRequests == 0` (no requests being processed).

#### `serve.healthCheck.idle.status`

- **Type:** `number`
- **Required:** No
- **Default:** `200`
- **Description:** HTTP status code.

#### `serve.healthCheck.idle.body`

- **Type:** `string` | `{ sh: string }`
- **Required:** No
- **Default:** `'{"status":"idle","activeRequests":0}'`
- **Description:** Response body. Supports two formats: string specification and command execution via `sh:`.

**String specification:** `@variable_name` within the string is dynamically expanded at request processing time.

| Variable | Type | Description |
|---|---|---|
| `@unix_time` | number | Current time (Unix epoch seconds) |
| `@active_requests` | number | Number of requests being processed |
| `@total_requests` | number | Total number of requests since server startup |
| `@uptime` | number | Elapsed seconds since server startup |

Environment variable expansion (`${VAR}`) is processed statically at load time, while dynamic variable expansion (`@var`) is processed later at request processing time. Both can be used together in the same string.

**`sh:` specification:** A shell command is executed on each evaluation, and the standard output (trailing newline removed) is used as the body. When `sh:` is specified, dynamic variable expansion (`@var`) is not applied. Environment variable expansion (`${VAR}`) is applied to the command string itself at load time. Since health checks are called frequently, be mindful of performance.

**Security note:** `sh:` directly executes the string written in `prepalert.yaml` as a shell command (arbitrary command execution). The command's stdout is returned as-is in the health check HTTP response body. The health check endpoint is unauthenticated (not subject to `serve.auth` even when configured) and exposed externally, so do not use commands that output sensitive information. This is designed with the assumption that `prepalert.yaml` is a trusted configuration file. Since environment variable expansion (`${VAR}`) is statically embedded into the command string, there is a shell injection risk if environment variables contain malicious values. When using environment variables in `sh:`, ensure only trusted values are set.

#### `serve.healthCheck.busy`

Response settings when `activeRequests > 0` (requests are being processed). Field structure is identical to `idle`.

#### `serve.healthCheck.busy.status`

- **Type:** `number`
- **Required:** No
- **Default:** `200`
- **Description:** HTTP status code.

#### `serve.healthCheck.busy.body`

- **Type:** `string` | `{ sh: string }`
- **Required:** No
- **Default:** `'{"status":"busy","activeRequests":<N>}'` (where `<N>` is the actual `activeRequests` value)
- **Description:** Response body. Supports two formats: string specification and command execution via `sh:`. See `serve.healthCheck.idle.body` for details.

#### `serve.webhooks`

List of webhook endpoints accepted by the `serve` command.

#### `serve.webhooks[].path`

- **Type:** `string`
- **Required:** Yes
- **Description:** Webhook path. Example: `/webhook/mackerel`. Using obscure paths can enhance security. Paths starting with `/`, `/index.html`, or `/api/` are reserved and cannot be used. Duplicate path definitions result in an error.

#### `serve.webhooks[].authType`

- **Type:** `"none"` | `"basic"` | `"oidc"`
- **Required:** Yes
- **Description:** Authentication method. On authentication failure, a `401` response is returned with a `WWW-Authenticate` header (`basic` → `Basic realm="prepalert"`, `oidc` → `Bearer realm="prepalert"`).

#### `serve.webhooks[].headerPrompt`

- **Type:** `string`
- **Required:** No
- **Default:** `"The following alert has been received:"`
- **Description:** Prompt header prepended to the request body received by the webhook. The final prompt passed to the Agent becomes `"{headerPrompt}\n\nPlease format your response in Markdown.\n\n{request body}"` (Markdown output instruction is automatically appended). Can be customized per webhook.

#### `serve.webhooks[].sync`

- **Type:** `boolean`
- **Required:** No
- **Default:** Value of `serve.syncMode` (if unset, `false`)
- **Description:** Sync mode for this webhook. When `true`, waits for Agent execution to complete before returning 200 OK. When `false`, immediately returns 202 Accepted and the Agent runs in the background. When `dispatch` is configured, the behavior as a dispatch origin (enqueueing a task to Cloud Tasks and returning immediately) is always asynchronous regardless of this setting. However, in the single-path pattern (when `dispatch.targetPath` is omitted), processing is synchronous when called back from Cloud Tasks.

#### `serve.webhooks[].ecsTaskProtection`

- **Type:** `"auto"` | `"off"`
- **Required:** No
- **Default:** Value of `serve.ecsTaskProtection` (if unset, `"auto"`)
- **Description:** ECS task protection setting for this webhook. Only effective in async mode (`sync: false`) and when `dispatch` is not configured.

#### `serve.webhooks[].username` / `serve.webhooks[].password`

- **Type:** `string`
- **Description:** Used when `authType: basic`. Can be injected from environment variables with `${ENV_VAR}`.

#### `serve.webhooks[].issuer` / `serve.webhooks[].audience`

- **Type:** `string`
- **Description:** Used when `authType: oidc`. Automatically resolves `issuer` -> `.well-known/openid-configuration` -> `jwksUri` to verify the JWT.

#### `serve.webhooks[].jwksUri`

- **Type:** `string`
- **Required:** No
- **Description:** Explicitly specifies the OIDC JWKS endpoint. When omitted, `issuer/.well-known/jwks.json` is used.

#### `serve.webhooks[].dispatch`

Forwarding settings to an external queue service. When configured, this webhook enqueues the received request to the queue and immediately returns a response. The actual Agent processing is executed when the queue service makes an HTTP call to `targetPath` (or to itself).

**Security Note:** In Cloud Run environments, headers added by Cloud Tasks (`X-CloudTasks-*`) can be spoofed from external sources (unlike App Engine, automatic header replacement is not performed). It is strongly recommended to set `authType: oidc` on the webhook that is the dispatch target and authenticate using Cloud Tasks' OIDC token (configured via `dispatch.oidc`). A warning is output at startup for targets with `authType: none`.

#### `serve.webhooks[].dispatch.type`

- **Type:** `"cloud-tasks"` | `"aws-sqs"`
- **Required:** Yes (when defining a `dispatch` block)
- **Description:** The type of external queue service to use. Tag field for discriminated union.

#### `serve.webhooks[].dispatch.queue`

- **Type:** `string`
- **Required:** Yes
- **Description:** Cloud Tasks queue resource name. Format: `projects/{project}/locations/{location}/queues/{queue}`. Can be injected from environment variables with `${ENV_VAR}`.

#### `serve.webhooks[].dispatch.targetPath`

- **Type:** `string`
- **Required:** No
- **Default:** Its own path (single-path pattern)
- **Description:** The webhook path that Cloud Tasks calls when executing a task. When omitted, it routes back to its own path (single-path pattern). When specified, it should reference a path defined within the same `webhooks` list.

**Two-stage endpoint pattern:** Specify a different webhook's path as `targetPath`. The dispatch endpoint and processing endpoint are clearly separated.

**Single-path pattern:** Omit `targetPath`. Callbacks from Cloud Tasks are identified by the `X-Prepalert-Dispatched` header (added at task creation time) and the `X-CloudTasks-TaskName` header (added by Cloud Tasks). When either header is present, dispatch is skipped and processing occurs directly. `X-Prepalert-Dispatched` is a custom header that prepalert-agent always adds at task creation time, preventing infinite loops even if the Cloud Tasks header is missing for some reason.

In the single-path pattern, since only one authType can be configured, combining it with `authType: basic` results in an error (Cloud Tasks does not have basic auth credentials, so authentication fails during callback). To accept basic auth from external sources and OIDC from Cloud Tasks, use the two-stage endpoint pattern.

#### `serve.webhooks[].dispatch.baseUrl`

- **Type:** `string`
- **Required:** No
- **Default:** Constructed from the request's `X-Forwarded-Proto` + `Host` headers
- **Description:** Base URL used by Cloud Tasks when executing tasks. Example: `https://my-service-xxx.run.app`. In reverse proxy environments like Cloud Run, this is automatically constructed from request headers, so it can usually be omitted. Explicitly specify when headers are not trustworthy or when the external public URL differs.

#### `serve.webhooks[].dispatch.dispatchDeadline`

- **Type:** `string`
- **Required:** No
- **Default:** The project's `timeout` setting value. When `timeout` is also unset, a warning log is output and Cloud Tasks' default is used
- **Description:** Maximum time Cloud Tasks waits for a single task execution. Duration format (`30m`, `1h`, etc.). Since Agent execution can take a long time, it is recommended to match the project's `timeout`. If too short, it can cause timeout -> retry -> duplicate execution. The maximum value follows Cloud Tasks' limit (30 minutes).

#### `serve.webhooks[].dispatch.oidc`

OIDC token settings that Cloud Tasks attaches when executing tasks. Required when the `targetPath` destination (or itself in the single-path pattern) requires `authType: oidc`.

#### `serve.webhooks[].dispatch.oidc.serviceAccountEmail`

- **Type:** `string`
- **Required:** No
- **Default:** Retrieves the default service account email address from the GCP metadata server
- **Description:** Service account used by Cloud Tasks for OIDC token generation. When omitted, it is retrieved from the execution environment's metadata server (`/computeMetadata/v1/instance/service-accounts/default/email`). The service account requires the `iam.serviceAccounts.actAs` permission.

#### `serve.webhooks[].dispatch.oidc.audience`

- **Type:** `string`
- **Required:** No
- **Default:** Value of `dispatch.baseUrl` (when baseUrl is also unset, the URL constructed from request headers)
- **Description:** Audience for the OIDC token. Typically matched to the Cloud Run service URL.

### AWS SQS dispatch

When `type: aws-sqs`, the request is converted to an API Gateway v2 event format and sent to an SQS queue. Used in Lambda + API Gateway v2 environments.

#### `serve.webhooks[].dispatch.queueUrl`

- **Type:** `string`
- **Required:** Yes
- **Description:** The SQS queue URL. Standard queues only (FIFO queues are not supported). Example: `https://sqs.ap-northeast-1.amazonaws.com/123456789012/my-queue`

#### `serve.webhooks[].dispatch.targetPath` (aws-sqs)

- **Type:** `string`
- **Required:** No
- **Default:** The original request path
- **Description:** The `rawPath` to set in the API Gateway v2 event within the SQS message. Like cloud-tasks `targetPath`, you can specify a different webhook path to configure a two-endpoint pattern.

#### `serve.webhooks[].dispatch.baseUrl` (aws-sqs)

- **Type:** `string`
- **Required:** No
- **Default:** Constructed from request headers
- **Description:** Base URL used for the `domainName` in the API Gateway v2 event.

## Relationship Between Permissions and Sub-agents

prepalert-agent executes runbooks as sub-agents (AgentDefinition).

- **permissionMode**: The parent's settings are inherited by sub-agents. `bypassPermissions`, `acceptEdits`, and `auto` cannot be overridden on the sub-agent side after inheritance
- **allowedTools / disallowedTools**: When set on the runbook side, they are applied as `tools` / `disallowedTools` in the sub-agent's AgentDefinition. When omitted, the parent's settings are inherited

## Startup Validation

The following validations are performed at `serve` command startup, and the process exits with an error if inconsistencies are found.

- Duplicate path definitions
- `dispatch.targetPath` exists within `webhooks`
- The target of `dispatch.targetPath` does not have `dispatch` configured (prevention of multi-stage forwarding and cycles)
- When the target of `dispatch.targetPath` requires `authType: oidc`, the `dispatch.oidc` configuration exists (or the environment allows retrieval from the metadata server)

## Examples

### ECS Environment (Traditional Configuration)

```yaml
name: my-web-api-monitoring
model: sonnet
effort: medium
maxTurns: 10
costLimit: 1.0
timeout: 15m

instructions: |
  This project monitors a Web API running on ECS.
  Please summarize investigation results in Japanese.

serve:
  port: 8080
  ecsTaskProtection: auto
  webhooks:
    - path: /webhook/mackerel
      authType: basic
      headerPrompt: "The following Mackerel alert has been received:"
      username: ${MACKEREL_WEBHOOK_USER}
      password: ${MACKEREL_WEBHOOK_PASS}
```

### Cloud Run + Cloud Tasks (Two-Stage Endpoint Pattern)

```yaml
name: my-web-api-monitoring
model: sonnet
timeout: 15m

serve:
  webhooks:
    # Receiver: enqueues to Cloud Tasks and returns immediately
    - path: /webhook/mackerel
      authType: basic
      username: ${MACKEREL_WEBHOOK_USER}
      password: ${MACKEREL_WEBHOOK_PASS}
      dispatch:
        type: cloud-tasks
        queue: ${CLOUD_TASKS_QUEUE}
        targetPath: /internal/process

    # Processor: called by Cloud Tasks for synchronous processing
    - path: /internal/process
      authType: oidc
      issuer: https://accounts.google.com
      audience: ${CLOUD_RUN_URL}
      sync: true
```

### Cloud Run + Cloud Tasks (Single-Path Pattern)

```yaml
name: my-web-api-monitoring
model: sonnet
timeout: 15m

serve:
  webhooks:
    # A single path handles both receiving and processing
    # - Normal request -> enqueue to Cloud Tasks -> 202
    # - X-CloudTasks-TaskName header present -> synchronous processing -> 200
    - path: /webhook/mackerel
      authType: oidc
      issuer: https://accounts.google.com
      audience: ${CLOUD_RUN_URL}
      sync: true
      dispatch:
        type: cloud-tasks
        queue: ${CLOUD_TASKS_QUEUE}
```

### Mixed Configuration (ECS + Sync Webhook)

```yaml
name: my-web-api-monitoring
model: sonnet
timeout: 15m

serve:
  ecsTaskProtection: auto
  webhooks:
    # Async + ECS task protection (default)
    - path: /webhook/mackerel
      authType: basic
      username: ${MACKEREL_WEBHOOK_USER}
      password: ${MACKEREL_WEBHOOK_PASS}

    # Only this endpoint uses sync mode
    - path: /webhook/external
      authType: oidc
      issuer: https://accounts.google.com
      audience: my-project
      sync: true
```

### For Bedrock AgentCore Runtime

AgentCore Runtime requires `GET /ping` to return `{"status":"Healthy"|"HealthyBusy","time_of_last_update":<unix_ts>}`. While returning `HealthyBusy` with the latest `time_of_last_update`, automatic termination of the session (microVM) is suppressed.

```yaml
name: my-web-api-monitoring
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
```
