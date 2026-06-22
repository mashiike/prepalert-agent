import { describe, test, expect } from "bun:test";
import {
  resolveHealthCheckConfig,
  buildHealthCheckResponse,
} from "../health.js";
import type { HealthCheckConfig } from "../project.js";

describe("resolveHealthCheckConfig", () => {
  test("returns defaults when config is undefined", () => {
    const resolved = resolveHealthCheckConfig(undefined);
    expect(resolved.path).toBe("/health");
    expect(resolved.contentType).toBe("application/json");
    expect(resolved.idle.status).toBe(200);
    expect(resolved.busy.status).toBe(200);
  });

  test("overrides path and contentType", () => {
    const config: HealthCheckConfig = {
      path: "/ping",
      contentType: "text/plain",
    };
    const resolved = resolveHealthCheckConfig(config);
    expect(resolved.path).toBe("/ping");
    expect(resolved.contentType).toBe("text/plain");
  });

  test("overrides idle and busy status", () => {
    const config: HealthCheckConfig = {
      idle: { status: 200 },
      busy: { status: 503 },
    };
    const resolved = resolveHealthCheckConfig(config);
    expect(resolved.idle.status).toBe(200);
    expect(resolved.busy.status).toBe(503);
  });

  test("overrides body with string", () => {
    const config: HealthCheckConfig = {
      idle: { body: '{"ok":true}' },
      busy: { body: '{"ok":false}' },
    };
    const resolved = resolveHealthCheckConfig(config);
    expect(resolved.idle.body).toBe('{"ok":true}');
    expect(resolved.busy.body).toBe('{"ok":false}');
  });

  test("overrides body with sh:", () => {
    const config: HealthCheckConfig = {
      idle: { body: { sh: "echo ok" } },
    };
    const resolved = resolveHealthCheckConfig(config);
    expect(resolved.idle.body).toEqual({ sh: "echo ok" });
  });
});

describe("buildHealthCheckResponse", () => {
  const baseCtx = {
    activeRequests: 0,
    totalRequests: 10,
    startTime: Date.now() - 60000,
  };

  test("returns idle response when activeRequests is 0", async () => {
    const config = resolveHealthCheckConfig(undefined);
    const response = buildHealthCheckResponse(config, baseCtx);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/json");
    const body = await response.text();
    expect(JSON.parse(body)).toEqual({ status: "idle", activeRequests: 0 });
  });

  test("returns busy response when activeRequests > 0", async () => {
    const config = resolveHealthCheckConfig(undefined);
    const ctx = { ...baseCtx, activeRequests: 3 };
    const response = buildHealthCheckResponse(config, ctx);
    const body = await response.text();
    expect(JSON.parse(body)).toEqual({ status: "busy", activeRequests: 3 });
  });

  test("expands @unix_time", async () => {
    const config = resolveHealthCheckConfig({
      idle: { body: '{"t":@unix_time}' },
    });
    const before = Math.floor(Date.now() / 1000);
    const response = buildHealthCheckResponse(config, baseCtx);
    const after = Math.floor(Date.now() / 1000);
    const body = JSON.parse(await response.text());
    expect(body.t).toBeGreaterThanOrEqual(before);
    expect(body.t).toBeLessThanOrEqual(after);
  });

  test("expands @active_requests", async () => {
    const config = resolveHealthCheckConfig({
      busy: { body: '{"active":@active_requests}' },
    });
    const ctx = { ...baseCtx, activeRequests: 5 };
    const response = buildHealthCheckResponse(config, ctx);
    const body = JSON.parse(await response.text());
    expect(body.active).toBe(5);
  });

  test("expands @total_requests", async () => {
    const config = resolveHealthCheckConfig({
      idle: { body: '{"total":@total_requests}' },
    });
    const response = buildHealthCheckResponse(config, baseCtx);
    const body = JSON.parse(await response.text());
    expect(body.total).toBe(10);
  });

  test("expands @uptime", async () => {
    const config = resolveHealthCheckConfig({
      idle: { body: '{"uptime":@uptime}' },
    });
    const response = buildHealthCheckResponse(config, baseCtx);
    const body = JSON.parse(await response.text());
    expect(body.uptime).toBeGreaterThanOrEqual(59);
    expect(body.uptime).toBeLessThanOrEqual(61);
  });

  test("expands multiple variables in one body", async () => {
    const config = resolveHealthCheckConfig({
      idle: { body: '{"t":@unix_time,"active":@active_requests,"total":@total_requests,"up":@uptime}' },
    });
    const response = buildHealthCheckResponse(config, baseCtx);
    const body = JSON.parse(await response.text());
    expect(typeof body.t).toBe("number");
    expect(body.active).toBe(0);
    expect(body.total).toBe(10);
    expect(typeof body.up).toBe("number");
  });

  test("executes sh: command for body", async () => {
    const config = resolveHealthCheckConfig({
      idle: { body: { sh: 'echo \'{"from":"shell"}\'' } },
    });
    const response = buildHealthCheckResponse(config, baseCtx);
    const body = JSON.parse(await response.text());
    expect(body.from).toBe("shell");
  });

  test("returns error body when sh: command fails", async () => {
    const config = resolveHealthCheckConfig({
      idle: { body: { sh: "exit 1" } },
    });
    const response = buildHealthCheckResponse(config, baseCtx);
    const body = JSON.parse(await response.text());
    expect(body.error).toBe("health check command failed");
  });

  test("respects custom status code", async () => {
    const config = resolveHealthCheckConfig({
      busy: { status: 503, body: "Service Busy" },
    });
    const ctx = { ...baseCtx, activeRequests: 1 };
    const response = buildHealthCheckResponse(config, ctx);
    expect(response.status).toBe(503);
    expect(await response.text()).toBe("Service Busy");
  });

  test("respects custom content type", async () => {
    const config = resolveHealthCheckConfig({
      contentType: "text/plain",
      idle: { body: "ok" },
    });
    const response = buildHealthCheckResponse(config, baseCtx);
    expect(response.headers.get("Content-Type")).toBe("text/plain");
    expect(await response.text()).toBe("ok");
  });

  test("AgentCore-style config", async () => {
    const config = resolveHealthCheckConfig({
      path: "/ping",
      idle: { body: '{"status":"Healthy","time_of_last_update":@unix_time}' },
      busy: { body: '{"status":"HealthyBusy","time_of_last_update":@unix_time}' },
    });
    const before = Math.floor(Date.now() / 1000);

    const idleResponse = buildHealthCheckResponse(config, baseCtx);
    const idleBody = JSON.parse(await idleResponse.text());
    expect(idleBody.status).toBe("Healthy");
    expect(idleBody.time_of_last_update).toBeGreaterThanOrEqual(before);

    const busyCtx = { ...baseCtx, activeRequests: 1 };
    const busyResponse = buildHealthCheckResponse(config, busyCtx);
    const busyBody = JSON.parse(await busyResponse.text());
    expect(busyBody.status).toBe("HealthyBusy");
    expect(busyBody.time_of_last_update).toBeGreaterThanOrEqual(before);
  });
});
