# Telemetry (OpenTelemetry)

prepalert-agent can send logs, metrics, and traces to an external destination via OTLP/HTTP using OpenTelemetry.

## Enabling

Set the environment variable `OTEL_EXPORTER_OTLP_ENDPOINT` to enable telemetry. When not set, telemetry is completely disabled (no overhead).

```bash
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
prepalert-agent run -p "アラートを調査して"
```

Setting `OTEL_SDK_DISABLED=true` explicitly disables telemetry even when the endpoint is configured.

## Environment Variables

Configuration follows the [OpenTelemetry standard environment variables](https://opentelemetry.io/docs/specs/otel/protocol/exporter/). There are no telemetry-specific settings in `prepalert.yaml`.

| Environment Variable | Description |
|---|---|
| `OTEL_EXPORTER_OTLP_ENDPOINT` | OTLP endpoint (e.g., `http://localhost:4318`). Telemetry is enabled when set |
| `OTEL_EXPORTER_OTLP_HEADERS` | Exporter headers (e.g., `api-key=xxx`) |
| `OTEL_SDK_DISABLED` | Set to `true` to explicitly disable |
| `OTEL_SERVICE_NAME` | Override service name (default: `prepalert-agent`) |
| `OTEL_RESOURCE_ATTRIBUTES` | Add resource attributes as comma-separated `key=value` pairs (e.g., `deployment.environment=production,service.instance.id=abc123`) |

Other `OTEL_EXPORTER_OTLP_*` environment variables also work according to the OpenTelemetry SDK standard specification.

## Resource Attributes

### Default Attributes

Attributes set in code. Can be overridden with `OTEL_SERVICE_NAME` / `OTEL_RESOURCE_ATTRIBUTES`.

| Attribute | Value | Override |
|---|---|---|
| `service.name` | `prepalert-agent` | `OTEL_SERVICE_NAME` |
| `service.version` | Package version (e.g., `0.0.1`) | `OTEL_RESOURCE_ATTRIBUTES` |

### Auto-detected Attributes

The following are automatically added by `envDetector`, `hostDetector`, and `processDetector`.

| Attribute | Example | Detected By |
|---|---|---|
| `host.name` | `ip-10-0-1-42` | hostDetector |
| `host.arch` | `amd64` | hostDetector |
| `process.pid` | `12345` | processDetector |
| `process.runtime.name` | `bun` | processDetector |
| `process.runtime.version` | `1.3.14` | processDetector |

### Adding Custom Attributes

Custom attributes can be freely added via the `OTEL_RESOURCE_ATTRIBUTES` environment variable.

```bash
OTEL_RESOURCE_ATTRIBUTES="deployment.environment=production,service.instance.id=ecs-task-abc123"
```

Keys and values containing `,` or `=` require percent-encoding.

## Traces

Spans are sent in a 3-level hierarchy: session > turn > tool execution.

### Span Structure

```
session                          # Entire session
├── turn-1                       # One turn from user input to result
│   ├── tool/Bash                # Tool execution
│   ├── tool/Read                # Tool execution
│   └── tool/Agent               # Sub-agent execution
└── turn-2
    └── tool/mcp__mackerel__*    # MCP tool execution
```

### Span Attributes

#### session Span

| Attribute | Type | Description |
|---|---|---|
| `session.id` | string | Session ID (same as the transcript directory name) |
| `session.cost_usd` | float | Cumulative cost at session end (USD) |

#### turn Span

| Attribute | Type | Description |
|---|---|---|
| `turn.number` | int | Turn number (1-based) |
| `turn.cost_usd` | float | Cumulative cost at result time (USD) |
| `turn.num_turns` | int | Internal SDK turn count |
| `turn.is_error` | boolean | Whether the turn ended with an error |
| `turn.input_tokens` | int | Input token count |
| `turn.output_tokens` | int | Output token count |

#### tool Span

| Attribute | Type | Description |
|---|---|---|
| `tool.id` | string | Tool call ID |
| `tool.name` | string | Tool name (e.g., `Bash`, `Read`, `mcp__mackerel__list_alerts`) |

### Headless Mode and Interactive Mode

- **Headless mode** (`-p` / `serve`): A single turn within the session span. Tool calls become child spans of that turn
- **Interactive mode**: A turn span is created for each user input. The `/reset` command does not affect turn numbering

## Metrics

| Metric Name | Type | Unit | Description |
|---|---|---|---|
| `prepalert.session.cost_usd` | Histogram | usd | Cumulative cost at session end |
| `prepalert.session.turns` | Counter | - | Cumulative SDK turn count |
| `prepalert.session.input_tokens` | Counter | - | Cumulative input token count |
| `prepalert.session.output_tokens` | Counter | - | Cumulative output token count |

Metrics are periodically exported by `PeriodicExportingMetricReader` (default interval: 60 seconds). For short-lived headless executions, metrics are flushed via `shutdown()` at process exit.

## Logs

In addition to the existing file logger (JSON Lines), the same log records are sent to the OTLP exporter via the OTel Logs API.

| Field | OTel Mapping |
|---|---|
| `level` | `severityText` (`DEBUG` / `INFO` / `WARN` / `ERROR`) + `severityNumber` |
| `msg` | `body` |
| Other fields | `attributes` |

File output (to the `logs/` directory) always occurs. OTel logs function as an additional destination, not a replacement for file logs.

## Architecture

```
┌───────────────────────────────────────────────┐
│  prepalert-agent                              │
│                                               │
│  FileLogger ──────────────→ logs/*.jsonl       │
│      │                                        │
│  OTelLogger (wrapper)                         │
│      ├── Logs   ──→ BatchLogRecordProcessor   │──→ OTLP/HTTP
│      │                                        │
│  SessionTelemetry                             │
│      ├── Traces ──→ BatchSpanProcessor        │──→ OTLP/HTTP
│      └── Metrics ─→ PeriodicMetricReader      │──→ OTLP/HTTP
└───────────────────────────────────────────────┘
```

- `OTelLogger`: Wraps the existing `Logger` interface and forwards to both the internal logger and the OTel Logs API
- `SessionTelemetry`: Manages span start/end and metric recording from the SDK message stream
- The exporter uses HTTP (JSON). gRPC is not used due to Bun compatibility

## Implementation Files

| File | Role |
|---|---|
| `src/telemetry.ts` | OTel initialization/shutdown, `OTelLogger`, `SessionTelemetry` |
| `src/commands/execute.ts` | Integration of SDK message stream with telemetry |
| `src/index.ts` | `initTelemetry()` call, logger wrapping |
