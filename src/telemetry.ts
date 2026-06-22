import { trace, metrics, context, SpanKind, SpanStatusCode, type Tracer, type Meter, type Span, type Context } from "@opentelemetry/api";
import { logs, SeverityNumber, type Logger as OTelApiLogger } from "@opentelemetry/api-logs";
import { BasicTracerProvider, BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { MeterProvider, PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { LoggerProvider, BatchLogRecordProcessor } from "@opentelemetry/sdk-logs";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { resourceFromAttributes, detectResources, envDetector, hostDetector, processDetector } from "@opentelemetry/resources";
import type { LogLevel, LogFields, Logger } from "./logger.js";

const SERVICE_NAME = "prepalert-agent";

let tracerProvider: BasicTracerProvider | null = null;
let meterProvider: MeterProvider | null = null;
let loggerProvider: LoggerProvider | null = null;
let enabled = false;

export function isOTelEnabled(): boolean {
  return enabled;
}

export function initTelemetry(version: string): void {
  if (process.env["OTEL_SDK_DISABLED"] === "true") return;
  if (!process.env["OTEL_EXPORTER_OTLP_ENDPOINT"]) return;

  enabled = true;

  const envResource = detectResources({ detectors: [envDetector, hostDetector, processDetector] });
  const baseResource = resourceFromAttributes({
    "service.name": SERVICE_NAME,
    "service.version": version,
  });
  const resource = baseResource.merge(envResource);

  tracerProvider = new BasicTracerProvider({
    resource,
    spanProcessors: [new BatchSpanProcessor(new OTLPTraceExporter())],
  });
  trace.setGlobalTracerProvider(tracerProvider);

  meterProvider = new MeterProvider({
    resource,
    readers: [new PeriodicExportingMetricReader({ exporter: new OTLPMetricExporter() })],
  });
  metrics.setGlobalMeterProvider(meterProvider);

  loggerProvider = new LoggerProvider({
    resource,
    processors: [new BatchLogRecordProcessor(new OTLPLogExporter())],
  });
  logs.setGlobalLoggerProvider(loggerProvider);
}

export async function shutdownTelemetry(): Promise<void> {
  if (!enabled) return;
  await Promise.allSettled([
    tracerProvider?.shutdown(),
    meterProvider?.shutdown(),
    loggerProvider?.shutdown(),
  ]);
}

export function getTracer(): Tracer {
  return trace.getTracer(SERVICE_NAME);
}

export function getMeter(): Meter {
  return metrics.getMeter(SERVICE_NAME);
}

const LOG_LEVEL_TO_SEVERITY: Record<LogLevel, SeverityNumber> = {
  debug: SeverityNumber.DEBUG,
  info: SeverityNumber.INFO,
  warn: SeverityNumber.WARN,
  error: SeverityNumber.ERROR,
};

function getOTelLogger(): OTelApiLogger {
  return logs.getLogger(SERVICE_NAME);
}

function emitOTelLog(level: LogLevel, msg: string, fields?: LogFields): void {
  if (!enabled) return;
  getOTelLogger().emit({
    severityNumber: LOG_LEVEL_TO_SEVERITY[level],
    severityText: level.toUpperCase(),
    body: msg,
    attributes: fields as Record<string, string | number | boolean | undefined>,
  });
}

/**
 * Logger wrapper that forwards log records to both the inner logger and OTel Logs.
 */
export class OTelLogger implements Logger {
  constructor(private readonly inner: Logger) {}

  debug(msg: string, fields?: LogFields): void {
    this.inner.debug(msg, fields);
    emitOTelLog("debug", msg, fields);
  }

  info(msg: string, fields?: LogFields): void {
    this.inner.info(msg, fields);
    emitOTelLog("info", msg, fields);
  }

  warn(msg: string, fields?: LogFields): void {
    this.inner.warn(msg, fields);
    emitOTelLog("warn", msg, fields);
  }

  error(msg: string, fields?: LogFields): void {
    this.inner.error(msg, fields);
    emitOTelLog("error", msg, fields);
  }

  flush(): void {
    if ("flush" in this.inner && typeof this.inner.flush === "function") {
      this.inner.flush();
    }
  }
}

export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  server_tool_use_input_tokens?: number;
}

/**
 * Manages OTel spans and metrics for a single session.
 */
export class SessionTelemetry {
  private readonly tracer: Tracer;
  private readonly meter: Meter;
  private readonly sessionSpan: Span;
  private readonly sessionCtx: Context;
  private turnSpan: Span | null = null;
  private turnCtx: Context | null = null;
  private turnCount = 0;
  private readonly toolSpans = new Map<string, { span: Span; startTime: number }>();

  private readonly costHistogram;
  private readonly turnsCounter;
  private readonly inputTokensCounter;
  private readonly outputTokensCounter;

  constructor(sessionId: string) {
    this.tracer = getTracer();
    this.meter = getMeter();

    this.sessionSpan = this.tracer.startSpan("session", {
      kind: SpanKind.INTERNAL,
      attributes: { "session.id": sessionId },
    });
    this.sessionCtx = trace.setSpan(context.active(), this.sessionSpan);

    this.costHistogram = this.meter.createHistogram("prepalert.session.cost_usd", {
      description: "Total cost in USD per session",
      unit: "usd",
    });
    this.turnsCounter = this.meter.createCounter("prepalert.session.turns", {
      description: "Total number of turns per session",
    });
    this.inputTokensCounter = this.meter.createCounter("prepalert.session.input_tokens", {
      description: "Total input tokens consumed",
    });
    this.outputTokensCounter = this.meter.createCounter("prepalert.session.output_tokens", {
      description: "Total output tokens consumed",
    });
  }

  startTurn(): void {
    this.endTurn();
    this.turnCount++;
    this.turnSpan = this.tracer.startSpan(`turn-${this.turnCount}`, {
      kind: SpanKind.INTERNAL,
      attributes: { "turn.number": this.turnCount },
    }, this.sessionCtx);
    this.turnCtx = trace.setSpan(this.sessionCtx, this.turnSpan);
  }

  startTools(tools: Array<{ id: string; name: string }>): void {
    const parentCtx = this.turnCtx ?? this.sessionCtx;
    for (const tool of tools) {
      const span = this.tracer.startSpan(`tool/${tool.name}`, {
        kind: SpanKind.INTERNAL,
        attributes: {
          "tool.id": tool.id,
          "tool.name": tool.name,
        },
      }, parentCtx);
      this.toolSpans.set(tool.id, { span, startTime: Date.now() });
    }
  }

  endTools(toolUseIds: string[]): void {
    for (const id of toolUseIds) {
      const entry = this.toolSpans.get(id);
      if (entry) {
        entry.span.end();
        this.toolSpans.delete(id);
      }
    }
  }

  recordResult(costUsd: number, numTurns: number, isError: boolean, usage?: TokenUsage): void {
    if (this.turnSpan) {
      this.turnSpan.setAttributes({
        "turn.cost_usd": costUsd,
        "turn.num_turns": numTurns,
        "turn.is_error": isError,
      });
      if (usage) {
        this.turnSpan.setAttributes({
          "turn.input_tokens": usage.input_tokens,
          "turn.output_tokens": usage.output_tokens,
        });
      }
    }

    this.turnsCounter.add(numTurns);
    if (usage) {
      this.inputTokensCounter.add(usage.input_tokens);
      this.outputTokensCounter.add(usage.output_tokens);
    }
  }

  private endTurn(): void {
    for (const [, entry] of this.toolSpans) {
      entry.span.setStatus({ code: SpanStatusCode.ERROR, message: "turn ended before tool completed" });
      entry.span.end();
    }
    this.toolSpans.clear();

    if (this.turnSpan) {
      this.turnSpan.end();
      this.turnSpan = null;
      this.turnCtx = null;
    }
  }

  end(costUsd?: number, isError?: boolean): void {
    this.endTurn();

    if (costUsd !== undefined) {
      this.sessionSpan.setAttribute("session.cost_usd", costUsd);
      this.costHistogram.record(costUsd);
    }
    if (isError) {
      this.sessionSpan.setStatus({ code: SpanStatusCode.ERROR });
    }
    this.sessionSpan.end();
  }
}
