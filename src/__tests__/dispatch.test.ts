import { describe, test, expect } from "bun:test";
import { resolveBaseUrl, resolveDispatchDeadlineSeconds, createCloudTask } from "../dispatch.js";
import { DISPATCH_TOKEN_HEADER } from "../dispatch-token.js";
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
    expect(resolveDispatchDeadlineSeconds("30m", "15m")).toBe(1800);
  });

  test("falls back to project timeout", () => {
    expect(resolveDispatchDeadlineSeconds(undefined, "15m")).toBe(900);
  });

  test("returns undefined when both are unset", () => {
    const result = resolveDispatchDeadlineSeconds(undefined, undefined);
    expect(result).toBeUndefined();
  });

  test("clamps to Cloud Tasks max (1800s) when over 30m", () => {
    expect(resolveDispatchDeadlineSeconds("60m", undefined)).toBe(1800);
    expect(resolveDispatchDeadlineSeconds(undefined, "1h")).toBe(1800);
  });

  test("clamps to Cloud Tasks min (15s) when under 15s", () => {
    expect(resolveDispatchDeadlineSeconds("5s", undefined)).toBe(15);
  });

  test("passes through values within range", () => {
    expect(resolveDispatchDeadlineSeconds("30m", undefined)).toBe(1800);
    expect(resolveDispatchDeadlineSeconds("20s", undefined)).toBe(20);
  });
});

function makeFakeCloudTasksClient() {
  const calls: unknown[] = [];
  const client = {
    createTask: async (args: unknown) => {
      calls.push(args);
      return [{ name: "projects/test/locations/us-central1/queues/q/tasks/t-123" }];
    },
  };
  return { client, calls };
}

describe("createCloudTask", () => {
  test("includes the dispatch token header in task http request", async () => {
    const { client, calls } = makeFakeCloudTasksClient();
    const config = makeConfig({ baseUrl: "https://my-service.run.app" });
    const request = makeRequest("http://localhost:8080/webhook/mackerel");

    await createCloudTask({
      config, request, body: '{"alert":"test"}', projectTimeout: "15m",
      dispatchToken: "tok", logger: noopLogger as never, client,
    });

    expect(calls.length).toBe(1);
    const task = (calls[0] as { task: { httpRequest: { headers: Record<string, string> } } }).task;
    expect(task.httpRequest.headers[DISPATCH_TOKEN_HEADER]).toBe("tok");
  });

  test("sets correct target URL from config baseUrl and request path", async () => {
    const { client, calls } = makeFakeCloudTasksClient();
    const config = makeConfig({ baseUrl: "https://my-service.run.app" });
    const request = makeRequest("http://localhost:8080/webhook/mackerel");

    await createCloudTask({
      config, request, body: '{"alert":"test"}', projectTimeout: undefined,
      dispatchToken: "tok", logger: noopLogger as never, client,
    });

    const task = (calls[0] as { task: { httpRequest: { url: string } } }).task;
    expect(task.httpRequest.url).toBe("https://my-service.run.app/webhook/mackerel");
  });

  test("uses targetPath when configured", async () => {
    const { client, calls } = makeFakeCloudTasksClient();
    const config = makeConfig({ baseUrl: "https://my-service.run.app", targetPath: "/internal/process" });
    const request = makeRequest("http://localhost:8080/webhook/mackerel");

    await createCloudTask({
      config, request, body: '{"alert":"test"}', projectTimeout: undefined,
      dispatchToken: "tok", logger: noopLogger as never, client,
    });

    const task = (calls[0] as { task: { httpRequest: { url: string } } }).task;
    expect(task.httpRequest.url).toBe("https://my-service.run.app/internal/process");
  });

  test("sets Content-Type header to application/json", async () => {
    const { client, calls } = makeFakeCloudTasksClient();
    const config = makeConfig({ baseUrl: "https://my-service.run.app" });
    const request = makeRequest("http://localhost:8080/webhook/test");

    await createCloudTask({
      config, request, body: "{}", projectTimeout: undefined,
      dispatchToken: "tok", logger: noopLogger as never, client,
    });

    const task = (calls[0] as { task: { httpRequest: { headers: Record<string, string> } } }).task;
    expect(task.httpRequest.headers["Content-Type"]).toBe("application/json");
  });

  test("sets dispatchDeadline when timeout is configured", async () => {
    const { client, calls } = makeFakeCloudTasksClient();
    const config = makeConfig({ baseUrl: "https://my-service.run.app", dispatchDeadline: "30m" });
    const request = makeRequest("http://localhost:8080/webhook/test");

    await createCloudTask({
      config, request, body: "{}", projectTimeout: undefined,
      dispatchToken: "tok", logger: noopLogger as never, client,
    });

    const task = (calls[0] as { task: { dispatchDeadline: { seconds: number } } }).task;
    expect(task.dispatchDeadline).toEqual({ seconds: 1800 });
  });

  test("omits dispatchDeadline when no timeout is configured", async () => {
    const { client, calls } = makeFakeCloudTasksClient();
    const config = makeConfig({ baseUrl: "https://my-service.run.app" });
    const request = makeRequest("http://localhost:8080/webhook/test");

    await createCloudTask({
      config, request, body: "{}", projectTimeout: undefined,
      dispatchToken: "tok", logger: noopLogger as never, client,
    });

    const task = (calls[0] as { task: { dispatchDeadline?: unknown } }).task;
    expect(task.dispatchDeadline).toBeUndefined();
  });
});
