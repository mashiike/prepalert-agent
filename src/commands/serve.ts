import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Project, WebhookConfig, ServeConfig, DispatchConfig, CloudTasksDispatchConfig } from "../project.js";
import type { AuthConfig } from "../auth.js";
import { verifyAuth } from "../auth.js";
import { executePrompt } from "./execute.js";
import { isEcsEnvironment, enableTaskProtection, disableTaskProtection } from "../ecs.js";
import { createCloudTask, resolveDispatchDeadlineSeconds } from "../dispatch.js";
import { generateDispatchToken, verifyDispatchToken, DISPATCH_TOKEN_HEADER } from "../dispatch-token.js";
import type { Logger } from "../logger.js";
import { resolveHealthCheckConfig, buildHealthCheckResponse } from "../health.js";
import { createSessionStorage, LocalSessionStorage, type SessionStorage } from "../storage.js";
import { SessionWriter } from "../session-writer.js";
import { handleApiRequest, type ApiContext } from "../api.js";
import { createSpaHandler } from "../spa.js";
import { resolveExportSecret, verifyExportToken } from "../export-token.js";
import { handleLogin, handleCallback, handleLogout, verifySession, resolveSessionSecret, type OidcConfig } from "../auth-session.js";
import { isLambdaEnvironment, startLambdaRuntime } from "../lambda.js";
import { sendToSqs } from "../sqs-dispatch.js";
import { parseDuration } from "../config.js";

const DEFAULT_HEADER_PROMPT = "The following alert has been received:";

const RESERVED_PATHS = new Set(["/", "/index.html"]);
const RESERVED_PREFIXES = ["/api/", "/sessions/", "/export/", "/auth/"];

function isReservedPath(path: string): boolean {
  if (RESERVED_PATHS.has(path)) return true;
  return RESERVED_PREFIXES.some(prefix => path.startsWith(prefix));
}

function toAuthConfig(webhook: WebhookConfig): AuthConfig {
  switch (webhook.authType) {
    case "none":
      return { authType: "none" };
    case "basic":
      return {
        authType: "basic",
        username: webhook.username ?? "",
        password: webhook.password ?? "",
      };
    case "oidc":
      return {
        authType: "oidc",
        issuer: webhook.issuer ?? "",
        audience: webhook.audience ?? "",
        jwksUri: webhook.jwksUri,
      };
  }
}

const MARKDOWN_OUTPUT_INSTRUCTION = "\n\nPlease format your response in Markdown.";

function buildWebhookPrompt(webhook: WebhookConfig, body: string): string {
  const header = webhook.headerPrompt ?? DEFAULT_HEADER_PROMPT;
  return `${header}${MARKDOWN_OUTPUT_INSTRUCTION}\n\n${body}`;
}

const LAMBDA_MAX_TIMEOUT_SECONDS = 900;

function resolveSync(webhook: WebhookConfig, project: Project, logger: Logger): boolean {
  const configured = webhook.sync ?? project.config.serve?.syncMode ?? false;
  if (isLambdaEnvironment() && !configured) {
    logger.warn(
      `webhook "${webhook.path}" is configured as async but Lambda does not support fire-and-forget execution; forcing sync mode`,
      { path: webhook.path },
    );
    return true;
  }
  return configured;
}

function resolveEcsTaskProtection(webhook: WebhookConfig, project: Project): "auto" | "off" {
  return webhook.ecsTaskProtection ?? project.config.serve?.ecsTaskProtection ?? "auto";
}

function shouldUseTaskProtectionForWebhook(webhook: WebhookConfig, project: Project, logger: Logger): boolean {
  if (resolveSync(webhook, project, logger)) return false;
  if (webhook.dispatch) return false;
  const setting = resolveEcsTaskProtection(webhook, project);
  if (setting === "off") return false;
  return isEcsEnvironment();
}

const VALID_HOST_PATTERN = /^[a-zA-Z0-9.-]+(:\d+)?$/;

function resolveBaseUrl(configured: string | undefined, request: Request, url: URL): string {
  if (configured) {
    return configured.replace(/\/$/, "");
  }
  const forwardedHost = request.headers.get("x-forwarded-host");
  const forwardedProto = request.headers.get("x-forwarded-proto")
    ?? request.headers.get("cloudfront-forwarded-proto");
  if (forwardedHost && VALID_HOST_PATTERN.test(forwardedHost)) {
    const proto = forwardedProto ?? "https";
    return `${proto}://${forwardedHost}`;
  }
  if (forwardedProto) {
    return `${forwardedProto}://${url.host}`;
  }
  return `${url.protocol}//${url.host}`;
}

async function handleExportDownload(sessionId: string, ctx: ApiContext): Promise<Response> {
  try {
    const zip = await ctx.storage.exportAsZip(sessionId);
    return new Response(zip, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${sessionId}.zip"`,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    ctx.logger.error("export download failed", { sessionId, error: msg });
    return new Response("Internal Server Error", { status: 500 });
  }
}

function writeOutputMd(sessionDir: string, responseText: string, logger: Logger): void {
  const outputPath = join(sessionDir, "output.md");
  try {
    writeFileSync(outputPath, responseText);
    logger.info("output written", { path: outputPath });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error("failed to write output.md", { path: outputPath, error: msg });
  }
}

async function executeSession(
  project: Project,
  prompt: string,
  mode: string,
  logger: Logger,
  sessionsDir: string,
  storage: SessionStorage | null,
  baseUrl?: string | undefined,
): Promise<void> {
  const writer = new SessionWriter(sessionsDir, storage, { logger });
  logger.info("session created", { sessionId: writer.sessionId, mode });
  await writer.writeMetadata({ createdAt: new Date().toISOString(), status: "running" });
  try {
    const result = await executePrompt(project, prompt, { logger, transcriptWriter: writer, baseUrl });
    writeOutputMd(writer.sessionDir, result.responseText, logger);
    await writer.writeMetadata({ createdAt: new Date().toISOString(), status: result.isError ? "error" : "completed" });
  } catch (e) {
    await writer.writeMetadata({ createdAt: new Date().toISOString(), status: "error" });
    throw e;
  } finally {
    await writer.close();
  }
}

async function executeAsync(
  project: Project,
  webhook: WebhookConfig,
  prompt: string,
  logger: Logger,
  sessionsDir: string,
  storage: SessionStorage | null,
  baseUrl: string,
  onStart: () => void,
  onEnd: () => void,
): Promise<void> {
  const useProtection = shouldUseTaskProtectionForWebhook(webhook, project, logger);
  if (useProtection) {
    await enableTaskProtection(project.config.timeout, logger);
  }
  onStart();
  try {
    await executeSession(project, prompt, "async", logger, sessionsDir, storage, baseUrl);
  } finally {
    onEnd();
    if (useProtection) {
      await disableTaskProtection(logger);
    }
  }
}

const DISPATCH_TOKEN_FALLBACK_TTL_SECONDS = 900;

async function dispatchRequest(
  config: DispatchConfig,
  request: Request,
  body: string,
  projectTimeout: string | undefined,
  dispatchSecret: Uint8Array,
  logger: Logger,
): Promise<void> {
  const deadline = config.type === "cloud-tasks"
    ? resolveDispatchDeadlineSeconds(config.dispatchDeadline, projectTimeout)
    : resolveDispatchDeadlineSeconds(undefined, projectTimeout);
  const ttl = deadline ?? DISPATCH_TOKEN_FALLBACK_TTL_SECONDS;
  const dispatchToken = await generateDispatchToken(dispatchSecret, ttl, new URL(request.url).pathname);

  switch (config.type) {
    case "cloud-tasks":
      await createCloudTask({ config, request, body, projectTimeout, dispatchToken, logger });
      break;
    case "aws-sqs":
      await sendToSqs({ config, request, body, dispatchToken, logger });
      break;
  }
}

const VALID_AUTH_TYPES = new Set(["none", "basic", "oidc"]);
const VALID_DISPATCH_TYPES = new Set(["cloud-tasks", "aws-sqs"]);

export function validateWebhooks(webhooks: WebhookConfig[], logger?: Logger | undefined, healthCheckPath?: string | undefined, projectTimeout?: string | undefined): void {
  const pathSet = new Set<string>();
  const webhookMap = new Map<string, WebhookConfig>();

  if (healthCheckPath && isReservedPath(healthCheckPath)) {
    throw new Error(`reserved path cannot be used as healthCheck path: ${healthCheckPath}`);
  }

  for (const wh of webhooks) {
    if (isReservedPath(wh.path)) {
      throw new Error(`reserved path cannot be used as webhook: ${wh.path}`);
    }
    if (!VALID_AUTH_TYPES.has(wh.authType)) {
      throw new Error(`webhook "${wh.path}" has invalid authType: "${wh.authType}" (expected "none", "basic", or "oidc")`);
    }
    if (healthCheckPath && wh.path === healthCheckPath) {
      throw new Error(`webhook path "${wh.path}" conflicts with healthCheck path`);
    }
    if (pathSet.has(wh.path)) {
      throw new Error(`duplicate webhook path: ${wh.path}`);
    }
    pathSet.add(wh.path);
    webhookMap.set(wh.path, wh);
  }

  for (const wh of webhooks) {
    if (!wh.dispatch) continue;

    if (!VALID_DISPATCH_TYPES.has(wh.dispatch.type)) {
      throw new Error(`dispatch on "${wh.path}" has invalid type: "${wh.dispatch.type}" (expected "cloud-tasks" or "aws-sqs")`);
    }

    if (wh.dispatch.type === "aws-sqs" && !wh.dispatch.queueUrl) {
      throw new Error(`dispatch on "${wh.path}" has type "aws-sqs" but queueUrl is not set`);
    }

    const { targetPath } = wh.dispatch;

    if (targetPath) {
      const target = webhookMap.get(targetPath);
      if (!target) {
        throw new Error(`dispatch.targetPath "${targetPath}" on "${wh.path}" references undefined webhook`);
      }
      if (target.dispatch) {
        throw new Error(`dispatch.targetPath "${targetPath}" on "${wh.path}" must not reference a webhook with dispatch (no chaining)`);
      }
    }

    if (wh.dispatch.type === "cloud-tasks") {
      const dd = (wh.dispatch as CloudTasksDispatchConfig).dispatchDeadline;
      if (!dd && !projectTimeout) {
        logger?.warn(
          `dispatch.dispatchDeadline and project timeout are both unset on "${wh.path}"; Cloud Tasks will use its default deadline which may be too short for agent execution`,
          { path: wh.path },
        );
      }
      const effective = dd ?? projectTimeout;
      if (effective && parseDuration(effective) > 1800) {
        logger?.warn(
          `dispatch deadline on "${wh.path}" exceeds Cloud Tasks maximum (30m); it will be clamped to 1800s`,
          { path: wh.path },
        );
      }
    }
  }
}

export interface ServeCommandOptions {
  logger: Logger;
  sessionsDir: string;
}

export type DispatchFn = (config: DispatchConfig, request: Request, body: string, projectTimeout: string | undefined, dispatchSecret: Uint8Array, logger: Logger) => Promise<void>;

export interface ServeContext {
  project: Project;
  serve: ServeConfig | undefined;
  webhookMap: Map<string, WebhookConfig>;
  storage: SessionStorage;
  remoteStorage: SessionStorage | null;
  sessionsDir: string;
  logger: Logger;
  healthCheckConfig: ReturnType<typeof resolveHealthCheckConfig>;
  exportSecret: Uint8Array;
  oidcConfig: OidcConfig | null;
  handleSpaRequest: ReturnType<typeof createSpaHandler>;
  stats: { activeRequests: number; totalRequests: number; startTime: number };
  dispatch?: DispatchFn | undefined;
}

function resolveSessionsDir(configured: string, logger: Logger): string {
  if (isLambdaEnvironment() && configured !== "/tmp" && !configured.startsWith("/tmp/")) {
    const fallback = "/tmp/prepalert-sessions";
    logger.warn(
      `sessionsDir "${configured}" is not under /tmp; on Lambda the filesystem is read-only except /tmp, so falling back to "${fallback}". Set sessionsDir under /tmp in prepalert.yaml to silence this warning.`,
      { configured, fallback },
    );
    return fallback;
  }
  return configured;
}

function initializeServeContext(project: Project, opts: ServeCommandOptions): ServeContext {
  const { logger } = opts;
  const sessionsDir = resolveSessionsDir(opts.sessionsDir, logger);
  const serve = project.config.serve;
  const webhooks = serve?.webhooks ?? [];

  if (webhooks.length === 0) {
    logger.warn("No webhooks configured in prepalert.yaml — serving SPA and API only");
  }

  const healthCheckConfig = resolveHealthCheckConfig(serve?.healthCheck);

  if (webhooks.length > 0) {
    try {
      validateWebhooks(webhooks, logger, healthCheckConfig.path, project.config.timeout);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      logger.error(message);
      process.exit(1);
    }
  }

  const webhookMap = new Map<string, WebhookConfig>();
  for (const wh of webhooks) {
    webhookMap.set(wh.path, wh);
  }

  const remoteStorage = createSessionStorage(project.config.storage, project.config.storageOptions, logger);
  const storage: SessionStorage = remoteStorage ?? new LocalSessionStorage(sessionsDir);
  const staticDir = serve?.staticDir ? join(project.dir, serve.staticDir) : undefined;
  const handleSpaRequest = createSpaHandler(staticDir);
  let exportSecret: Uint8Array;
  let exportAutoGen: boolean;
  try {
    ({ key: exportSecret, autoGenerated: exportAutoGen } = resolveExportSecret(serve?.exportSecret));
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    logger.error(`invalid serve.exportSecret: ${message}`);
    process.exit(1);
  }
  if (exportAutoGen) {
    logger.warn("exportSecret not configured — using auto-generated secret (export tokens will not survive server restarts). Set serve.exportSecret in prepalert.yaml for persistent tokens.");
  }

  let oidcConfig: OidcConfig | null = null;
  if (serve?.auth) {
    let sessionSecret: Uint8Array;
    let sessionAutoGen: boolean;
    try {
      ({ key: sessionSecret, autoGenerated: sessionAutoGen } = resolveSessionSecret(serve.sessionSecret));
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      logger.error(`invalid serve.sessionSecret: ${message}`);
      process.exit(1);
    }
    if (sessionAutoGen) {
      logger.warn("sessionSecret not configured — using auto-generated secret (sessions will not survive server restarts). Set serve.sessionSecret in prepalert.yaml.");
    }
    oidcConfig = {
      issuer: serve.auth.issuer,
      clientId: serve.auth.clientId,
      clientSecret: serve.auth.clientSecret,
      allowedDomains: serve.auth.allowedDomains,
      sessionSecret,
      baseUrl: "",
    };
    logger.info("OIDC authentication enabled", { issuer: serve.auth.issuer, allowedDomains: serve.auth.allowedDomains });
  } else {
    logger.warn("serve.auth not configured — the SPA and /api/* endpoints are unauthenticated. Configure serve.auth (OIDC) or put an authenticating proxy in front if these are exposed beyond a trusted network.");
  }

  if (isLambdaEnvironment() && project.config.timeout) {
    const timeoutSec = parseDuration(project.config.timeout);
    if (timeoutSec > LAMBDA_MAX_TIMEOUT_SECONDS) {
      logger.warn(
        `project timeout "${project.config.timeout}" exceeds Lambda maximum of ${LAMBDA_MAX_TIMEOUT_SECONDS}s; execution may be terminated by Lambda before completion`,
      );
    }
  }

  return {
    project,
    serve,
    webhookMap,
    storage,
    remoteStorage,
    sessionsDir,
    logger,
    healthCheckConfig,
    exportSecret,
    oidcConfig,
    handleSpaRequest,
    stats: { activeRequests: 0, totalRequests: 0, startTime: Date.now() },
  };
}

export function createFetchHandler(ctx: ServeContext): (request: Request) => Promise<Response> {
  const { project, serve, webhookMap, storage, remoteStorage, sessionsDir, logger, healthCheckConfig, exportSecret, oidcConfig, handleSpaRequest, stats } = ctx;
  const doDispatch = ctx.dispatch ?? dispatchRequest;

  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const start = Date.now();
    const baseUrl = resolveBaseUrl(serve?.baseUrl, request, url);
    const apiCtx: ApiContext = { storage, logger, exportSecret, baseUrl };

    if (request.method === "GET" && url.pathname === healthCheckConfig.path) {
      return buildHealthCheckResponse(healthCheckConfig, { activeRequests: stats.activeRequests, totalRequests: stats.totalRequests, startTime: stats.startTime });
    }

    if (request.method === "GET" && url.pathname.startsWith("/export/")) {
      const token = url.pathname.slice("/export/".length);
      if (!token) {
        return new Response("Not Found", { status: 404 });
      }
      const sessionId = await verifyExportToken(token, exportSecret);
      if (!sessionId) {
        return new Response("Forbidden", { status: 403 });
      }
      return handleExportDownload(sessionId, apiCtx);
    }

    if (oidcConfig) {
      const cfg = { ...oidcConfig, baseUrl };

      if (request.method === "GET" && url.pathname === "/auth/login") {
        const returnTo = url.searchParams.get("return_to") ?? undefined;
        return handleLogin(cfg, returnTo);
      }
      if (request.method === "GET" && url.pathname === "/auth/callback") {
        return handleCallback(request, cfg, logger);
      }
      if (request.method === "GET" && url.pathname === "/auth/logout") {
        return handleLogout(baseUrl);
      }

      if (!webhookMap.has(url.pathname)) {
        const session = await verifySession(request, cfg);
        if (!session) {
          if (url.pathname.startsWith("/api/")) {
            return new Response(JSON.stringify({ error: "unauthorized" }), {
              status: 401,
              headers: { "Content-Type": "application/json" },
            });
          }
          const returnTo = encodeURIComponent(url.pathname + url.search);
          return Response.redirect(`${baseUrl}/auth/login?return_to=${returnTo}`, 302);
        }
      }

      if (request.method === "POST" && url.pathname.startsWith("/api/")) {
        const ct = request.headers.get("content-type");
        if (!ct || !ct.includes("application/json")) {
          return new Response("Unsupported Media Type", { status: 415 });
        }
      }
    }

    if (url.pathname.startsWith("/api/")) {
      const apiResp = await handleApiRequest(request, url, apiCtx);
      const resp = apiResp ?? new Response("Not Found", { status: 404 });
      logger.info("request", { method: request.method, path: url.pathname, status: resp.status, duration_ms: Date.now() - start });
      return resp;
    }

    if (request.method === "GET") {
      const spaResp = handleSpaRequest(url);
      const resp = spaResp ?? new Response("Not Found", { status: 404 });
      logger.info("request", { method: request.method, path: url.pathname, status: resp.status, duration_ms: Date.now() - start });
      return resp;
    }

    const webhook = webhookMap.get(url.pathname);
    if (!webhook) {
      logger.info("request", { method: request.method, path: url.pathname, status: 404, duration_ms: Date.now() - start });
      return new Response("Not Found", { status: 404 });
    }

    if (request.method !== "POST") {
      logger.info("request", { method: request.method, path: url.pathname, status: 405, duration_ms: Date.now() - start });
      return new Response("Method Not Allowed", { status: 405 });
    }

    const dispatchTokenValue = request.headers.get(DISPATCH_TOKEN_HEADER);
    const dispatched = dispatchTokenValue !== null && await verifyDispatchToken(dispatchTokenValue, exportSecret, url.pathname);

    if (!dispatched) {
      const authConfig = toAuthConfig(webhook);
      const authResult = await verifyAuth(request, authConfig);
      if (!authResult.ok) {
        logger.warn("auth failed", { path: url.pathname, status: authResult.status, message: authResult.logMessage ?? authResult.message });
        return new Response(authResult.message, authResult.headers
          ? { status: authResult.status, headers: authResult.headers }
          : { status: authResult.status },
        );
      }
    }

    const body = await request.text();
    stats.totalRequests++;

    if (webhook.dispatch && !dispatched) {
      try {
        await doDispatch(webhook.dispatch, request, body, project.config.timeout, exportSecret, logger);
        logger.info("request dispatched", { method: request.method, path: url.pathname, type: webhook.dispatch.type, status: 202, duration_ms: Date.now() - start });
        return new Response("Accepted", { status: 202 });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error("dispatch failed", { path: url.pathname, error: message, status: 500, duration_ms: Date.now() - start });
        return new Response("Internal Server Error", { status: 500 });
      }
    }

    const prompt = buildWebhookPrompt(webhook, body);
    const isSync = resolveSync(webhook, project, logger);

    if (isSync) {
      stats.activeRequests++;
      try {
        await executeSession(project, prompt, "sync", logger, sessionsDir, remoteStorage, baseUrl);
        logger.info("request", { method: request.method, path: url.pathname, status: 200, duration_ms: Date.now() - start });
        return new Response("OK", { status: 200 });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error("executePrompt failed", { path: url.pathname, error: message });
        return new Response("Internal Server Error", { status: 500 });
      } finally {
        stats.activeRequests--;
      }
    }

    logger.info("request accepted", { method: request.method, path: url.pathname, status: 202 });
    executeAsync(
      project,
      webhook,
      prompt,
      logger,
      sessionsDir,
      remoteStorage,
      baseUrl,
      () => { stats.activeRequests++; },
      () => { stats.activeRequests--; },
    ).catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("executePrompt failed", { path: url.pathname, error: message });
    });

    return new Response("Accepted", { status: 202 });
  };
}

export function serveCommand(project: Project, port: number, opts: ServeCommandOptions): void {
  const ctx = initializeServeContext(project, opts);
  const { logger } = ctx;
  const handler = createFetchHandler(ctx);

  if (isLambdaEnvironment()) {
    logger.info("Lambda environment detected — starting Lambda runtime");
    startLambdaRuntime(handler, logger).catch((err) => {
      logger.error("Lambda runtime failed", { error: err instanceof Error ? err.message : String(err) });
      process.exit(1);
    });
    return;
  }

  const server = Bun.serve({ port, fetch: handler });

  logger.info("server started", {
    port: server.port,
    healthCheck: ctx.healthCheckConfig.path,
    storage: project.config.storage ?? "local",
    webhooks: (project.config.serve?.webhooks ?? []).map(wh => ({
      path: wh.path,
      authType: wh.authType,
      sync: resolveSync(wh, project, logger),
      dispatch: wh.dispatch?.type,
    })),
  });
}
