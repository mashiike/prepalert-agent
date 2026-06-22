import { execSync } from "node:child_process";
import type { HealthCheckConfig, HealthCheckStateConfig } from "./project.js";

export interface HealthCheckContext {
  activeRequests: number;
  totalRequests: number;
  startTime: number;
}

interface ResolvedStateConfig {
  status: number;
  body: string | { sh: string };
}

interface ResolvedHealthCheck {
  path: string;
  contentType: string;
  idle: ResolvedStateConfig;
  busy: ResolvedStateConfig;
}

const DEFAULT_IDLE_BODY = '{"status":"idle","activeRequests":@active_requests}';
const DEFAULT_BUSY_BODY = '{"status":"busy","activeRequests":@active_requests}';

function resolveStateConfig(
  state: HealthCheckStateConfig | undefined,
  defaultBody: string,
): ResolvedStateConfig {
  return {
    status: state?.status ?? 200,
    body: state?.body ?? defaultBody,
  };
}

export function resolveHealthCheckConfig(config: HealthCheckConfig | undefined): ResolvedHealthCheck {
  return {
    path: config?.path ?? "/health",
    contentType: config?.contentType ?? "application/json",
    idle: resolveStateConfig(config?.idle, DEFAULT_IDLE_BODY),
    busy: resolveStateConfig(config?.busy, DEFAULT_BUSY_BODY),
  };
}

function expandDynamicVars(template: string, ctx: HealthCheckContext): string {
  const now = Math.floor(Date.now() / 1000);
  const uptime = Math.floor((Date.now() - ctx.startTime) / 1000);
  return template
    .replace(/@unix_time/g, String(now))
    .replace(/@active_requests/g, String(ctx.activeRequests))
    .replace(/@total_requests/g, String(ctx.totalRequests))
    .replace(/@uptime/g, String(uptime));
}

function evaluateBody(body: string | { sh: string }, ctx: HealthCheckContext): string {
  if (typeof body === "object" && "sh" in body) {
    try {
      return execSync(body.sh, { encoding: "utf-8", timeout: 5000 }).trimEnd();
    } catch {
      return '{"error":"health check command failed"}';
    }
  }
  return expandDynamicVars(body, ctx);
}

export function buildHealthCheckResponse(
  config: ReturnType<typeof resolveHealthCheckConfig>,
  ctx: HealthCheckContext,
): Response {
  const isBusy = ctx.activeRequests > 0;
  const stateConfig = isBusy ? config.busy : config.idle;
  const body = evaluateBody(stateConfig.body, ctx);
  return new Response(body, {
    status: stateConfig.status,
    headers: { "Content-Type": config.contentType },
  });
}
