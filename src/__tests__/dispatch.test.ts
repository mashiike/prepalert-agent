import { describe, test, expect, mock, afterEach } from "bun:test";
import { isDispatchedRequest, resolveBaseUrl, resolveDispatchDeadlineSeconds, createCloudTask, resetClient, DISPATCHED_HEADER } from "../dispatch.js";
import type { CloudTasksDispatchConfig } from "../project.js";

function makeConfig(overrides: Partial<CloudTasksDispatchConfig> = {}): CloudTasksDispatchConfig {
  return {
    type: "cloud-tasks",
    queue: "projects/test/locations/us-central1/queues/test-queue",
    ...overrides,
  };
}

function makeRequest(url: string, headers: Record<string, string> = {}): Request {
  return new Request(url, { method: "POST", headers });
}

describe("isDispatchedRequest", () => {
  test("returns true when X-CloudTasks-TaskName header is present", () => {
    const request = makeRequest("http://localhost:8080/webhook", {
      "X-CloudTasks-TaskName": "task-123",
    });
    expect(isDispatchedRequest(request)).toBe(true);
  });

  test("returns true when X-Prepalert-Dispatched header is present", () => {
    const request = makeRequest("http://localhost:8080/webhook", {
      "X-Prepalert-Dispatched": "true",
    });
    expect(isDispatchedRequest(request)).toBe(true);
  });

  test("returns true when both headers are present", () => {
    const request = makeRequest("http://localhost:8080/webhook", {
      "X-CloudTasks-TaskName": "task-123",
      "X-Prepalert-Dispatched": "true",
    });
    expect(isDispatchedRequest(request)).toBe(true);
  });

  test("returns false when no dispatch headers are present", () => {
    const request = makeRequest("http://localhost:8080/webhook");
    expect(isDispatchedRequest(request)).toBe(false);
  });
});

describe("resolveBaseUrl", () => {
  test("uses explicit baseUrl from config", () => {
    const config = makeConfig({ baseUrl: "https://my-service.run.app" });
    const request = makeRequest("http://localhost:8080/webhook");
    expect(resolveBaseUrl(config, request)).toBe("https://my-service.run.app");
  });

  test("strips trailing slash from explicit baseUrl", () => {
    const config = makeConfig({ baseUrl: "https://my-service.run.app/" });
    const request = makeRequest("http://localhost:8080/webhook");
    expect(resolveBaseUrl(config, request)).toBe("https://my-service.run.app");
  });

  test("constructs from X-Forwarded-Proto and Host headers", () => {
    const config = makeConfig();
    const request = makeRequest("http://localhost:8080/webhook", {
      "X-Forwarded-Proto": "https",
      Host: "my-service.run.app",
    });
    expect(resolveBaseUrl(config, request)).toBe("https://my-service.run.app");
  });

  test("defaults proto to http when X-Forwarded-Proto is absent", () => {
    const config = makeConfig();
    const request = makeRequest("http://localhost:8080/webhook", {
      Host: "localhost:8080",
    });
    expect(resolveBaseUrl(config, request)).toBe("http://localhost:8080");
  });

  test("throws when no Host header and no baseUrl", () => {
    const config = makeConfig();
    const request = new Request("http://localhost:8080/webhook", {
      method: "POST",
    });
    Object.defineProperty(request, "headers", {
      value: new Headers(),
    });
    expect(() => resolveBaseUrl(config, request)).toThrow("Cannot resolve baseUrl");
  });
});

const noopLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

describe("resolveDispatchDeadlineSeconds", () => {

  test("uses dispatchDeadline when provided", () => {
    expect(resolveDispatchDeadlineSeconds("30m", "15m", noopLogger as never)).toBe(1800);
  });

  test("falls back to project timeout", () => {
    expect(resolveDispatchDeadlineSeconds(undefined, "15m", noopLogger as never)).toBe(900);
  });

  test("returns undefined and warns when both are unset", () => {
    let warned = false;
    const warnLogger = {
      ...noopLogger,
      warn: () => { warned = true; },
    };
    const result = resolveDispatchDeadlineSeconds(undefined, undefined, warnLogger as never);
    expect(result).toBeUndefined();
    expect(warned).toBe(true);
  });
});

describe("createCloudTask", () => {
  let capturedArgs: unknown = null;

  mock.module("@google-cloud/tasks", () => ({
    CloudTasksClient: class {
      async createTask(args: unknown) {
        capturedArgs = args;
        return [{ name: "projects/test/locations/us-central1/queues/q/tasks/t-123" }];
      }
    },
    protos: {
      google: { cloud: { tasks: { v2: {} } } },
    },
  }));

  afterEach(() => {
    capturedArgs = null;
    resetClient();
  });

  test("includes x-prepalert-dispatched header in task http request", async () => {
    const config = makeConfig({ baseUrl: "https://my-service.run.app" });
    const request = makeRequest("http://localhost:8080/webhook/mackerel");

    await createCloudTask({
      config,
      request,
      body: '{"alert":"test"}',
      projectTimeout: "15m",
      logger: noopLogger as never,
    });

    expect(capturedArgs).not.toBeNull();
    const task = (capturedArgs as { task: { httpRequest: { headers: Record<string, string> } } }).task;
    expect(task.httpRequest.headers[DISPATCHED_HEADER]).toBe("true");
  });

  test("sets correct target URL from config baseUrl and request path", async () => {
    const config = makeConfig({ baseUrl: "https://my-service.run.app" });
    const request = makeRequest("http://localhost:8080/webhook/mackerel");

    await createCloudTask({
      config,
      request,
      body: '{"alert":"test"}',
      projectTimeout: undefined,
      logger: noopLogger as never,
    });

    const task = (capturedArgs as { task: { httpRequest: { url: string } } }).task;
    expect(task.httpRequest.url).toBe("https://my-service.run.app/webhook/mackerel");
  });

  test("uses targetPath when configured", async () => {
    const config = makeConfig({
      baseUrl: "https://my-service.run.app",
      targetPath: "/internal/process",
    });
    const request = makeRequest("http://localhost:8080/webhook/mackerel");

    await createCloudTask({
      config,
      request,
      body: '{"alert":"test"}',
      projectTimeout: undefined,
      logger: noopLogger as never,
    });

    const task = (capturedArgs as { task: { httpRequest: { url: string } } }).task;
    expect(task.httpRequest.url).toBe("https://my-service.run.app/internal/process");
  });

  test("sets Content-Type header to application/json", async () => {
    const config = makeConfig({ baseUrl: "https://my-service.run.app" });
    const request = makeRequest("http://localhost:8080/webhook/test");

    await createCloudTask({
      config,
      request,
      body: "{}",
      projectTimeout: undefined,
      logger: noopLogger as never,
    });

    const task = (capturedArgs as { task: { httpRequest: { headers: Record<string, string> } } }).task;
    expect(task.httpRequest.headers["Content-Type"]).toBe("application/json");
  });

  test("sets dispatchDeadline when timeout is configured", async () => {
    const config = makeConfig({ baseUrl: "https://my-service.run.app", dispatchDeadline: "30m" });
    const request = makeRequest("http://localhost:8080/webhook/test");

    await createCloudTask({
      config,
      request,
      body: "{}",
      projectTimeout: undefined,
      logger: noopLogger as never,
    });

    const task = (capturedArgs as { task: { dispatchDeadline: { seconds: number } } }).task;
    expect(task.dispatchDeadline).toEqual({ seconds: 1800 });
  });

  test("omits dispatchDeadline when no timeout is configured", async () => {
    const config = makeConfig({ baseUrl: "https://my-service.run.app" });
    const request = makeRequest("http://localhost:8080/webhook/test");

    await createCloudTask({
      config,
      request,
      body: "{}",
      projectTimeout: undefined,
      logger: noopLogger as never,
    });

    const task = (capturedArgs as { task: { dispatchDeadline?: unknown } }).task;
    expect(task.dispatchDeadline).toBeUndefined();
  });
});
