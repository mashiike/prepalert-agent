import { describe, test, expect, afterEach } from "bun:test";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadProject } from "../project.js";
import { validateWebhooks, createFetchHandler, type ServeContext, type DispatchFn } from "../commands/serve.js";
import type { WebhookConfig, Project, DispatchConfig } from "../project.js";
import { LocalSessionStorage } from "../storage.js";

async function createTempProject(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "prepalert-serve-test-"));
  for (const [path, content] of Object.entries(files)) {
    const fullPath = join(dir, path);
    await mkdir(join(fullPath, ".."), { recursive: true });
    await writeFile(fullPath, content);
  }
  return dir;
}

describe("serve webhook config loading", () => {
  test("loads webhooks from prepalert.yaml", async () => {
    const dir = await createTempProject({
      "prepalert.yaml": `
name: test
serve:
  port: 9090
  webhooks:
    - path: /webhook/test
      authType: none
    - path: /webhook/secure
      authType: basic
      username: admin
      password: secret
`,
    });
    const project = await loadProject(dir);
    expect(project.config.serve?.port).toBe(9090);
    expect(project.config.serve?.webhooks).toHaveLength(2);
    expect(project.config.serve?.webhooks![0]!.path).toBe("/webhook/test");
    expect(project.config.serve?.webhooks![0]!.authType).toBe("none");
    expect(project.config.serve?.webhooks![1]!.authType).toBe("basic");
    expect(project.config.serve?.webhooks![1]!.username).toBe("admin");
    await rm(dir, { recursive: true });
  });

  test("loads healthCheck config from prepalert.yaml", async () => {
    const dir = await createTempProject({
      "prepalert.yaml": `
name: test
serve:
  healthCheck:
    path: /ping
    contentType: application/json
    idle:
      status: 200
      body: '{"status":"Healthy","time_of_last_update":@unix_time}'
    busy:
      status: 200
      body: '{"status":"HealthyBusy","time_of_last_update":@unix_time}'
  webhooks:
    - path: /webhook/test
      authType: none
`,
    });
    const project = await loadProject(dir);
    const hc = project.config.serve?.healthCheck;
    expect(hc?.path).toBe("/ping");
    expect(hc?.contentType).toBe("application/json");
    expect(hc?.idle?.status).toBe(200);
    expect(hc?.idle?.body).toBe('{"status":"Healthy","time_of_last_update":@unix_time}');
    expect(hc?.busy?.body).toBe('{"status":"HealthyBusy","time_of_last_update":@unix_time}');
    await rm(dir, { recursive: true });
  });

  test("loads healthCheck with sh: body", async () => {
    const dir = await createTempProject({
      "prepalert.yaml": `
name: test
serve:
  healthCheck:
    path: /ping
    idle:
      body:
        sh: "echo ok"
  webhooks:
    - path: /webhook/test
      authType: none
`,
    });
    const project = await loadProject(dir);
    const hc = project.config.serve?.healthCheck;
    expect(hc?.idle?.body).toEqual({ sh: "echo ok" });
    await rm(dir, { recursive: true });
  });

  test("loads headerPrompt from webhook config", async () => {
    const dir = await createTempProject({
      "prepalert.yaml": `
name: test
serve:
  webhooks:
    - path: /webhook/mackerel
      authType: none
      headerPrompt: "The following Mackerel alert has been received:"
    - path: /webhook/default
      authType: none
`,
    });
    const project = await loadProject(dir);
    expect(project.config.serve?.webhooks![0]!.headerPrompt).toBe("The following Mackerel alert has been received:");
    expect(project.config.serve?.webhooks![1]!.headerPrompt).toBeUndefined();
    await rm(dir, { recursive: true });
  });

  test("expands env vars in webhook config", async () => {
    process.env["TEST_WH_USER"] = "env-user";
    process.env["TEST_WH_PASS"] = "env-pass";

    const dir = await createTempProject({
      "prepalert.yaml": `
name: test
serve:
  webhooks:
    - path: /webhook/env
      authType: basic
      username: \${TEST_WH_USER}
      password: \${TEST_WH_PASS}
`,
    });
    const project = await loadProject(dir);
    expect(project.config.serve?.webhooks![0]!.username).toBe("env-user");
    expect(project.config.serve?.webhooks![0]!.password).toBe("env-pass");

    delete process.env["TEST_WH_USER"];
    delete process.env["TEST_WH_PASS"];
    await rm(dir, { recursive: true });
  });

  test("loads oidc webhook with jwksUri", async () => {
    const dir = await createTempProject({
      "prepalert.yaml": `
name: test
serve:
  webhooks:
    - path: /webhook/gcp
      authType: oidc
      issuer: https://accounts.google.com
      audience: my-project
      jwksUri: https://www.googleapis.com/oauth2/v3/certs
`,
    });
    const project = await loadProject(dir);
    const wh = project.config.serve?.webhooks![0]!;
    expect(wh.authType).toBe("oidc");
    expect(wh.issuer).toBe("https://accounts.google.com");
    expect(wh.jwksUri).toBe("https://www.googleapis.com/oauth2/v3/certs");
    await rm(dir, { recursive: true });
  });

  test("loads webhook-level sync and ecsTaskProtection", async () => {
    const dir = await createTempProject({
      "prepalert.yaml": `
name: test
serve:
  syncMode: false
  ecsTaskProtection: auto
  webhooks:
    - path: /webhook/default
      authType: none
    - path: /webhook/sync
      authType: none
      sync: true
    - path: /webhook/no-ecs
      authType: none
      ecsTaskProtection: "off"
`,
    });
    const project = await loadProject(dir);
    const webhooks = project.config.serve?.webhooks!;
    expect(webhooks[0]!.sync).toBeUndefined();
    expect(webhooks[1]!.sync).toBe(true);
    expect(webhooks[2]!.ecsTaskProtection).toBe("off");
    await rm(dir, { recursive: true });
  });

  test("loads dispatch config from webhook", async () => {
    const dir = await createTempProject({
      "prepalert.yaml": `
name: test
serve:
  webhooks:
    - path: /webhook/gcp
      authType: oidc
      issuer: https://accounts.google.com
      audience: https://my-service.run.app
      dispatch:
        type: cloud-tasks
        queue: projects/my-proj/locations/asia-northeast1/queues/prepalert
        targetPath: /internal/process
        baseUrl: https://my-service.run.app
        dispatchDeadline: 30m
        oidc:
          serviceAccountEmail: sa@my-proj.iam.gserviceaccount.com
          audience: https://my-service.run.app
    - path: /internal/process
      authType: oidc
      issuer: https://accounts.google.com
      audience: https://my-service.run.app
      sync: true
`,
    });
    const project = await loadProject(dir);
    const webhooks = project.config.serve?.webhooks!;
    const dispatch = webhooks[0]!.dispatch!;
    expect(dispatch.type).toBe("cloud-tasks");
    if (dispatch.type !== "cloud-tasks") throw new Error("unexpected type");
    expect(dispatch.queue).toBe("projects/my-proj/locations/asia-northeast1/queues/prepalert");
    expect(dispatch.targetPath).toBe("/internal/process");
    expect(dispatch.baseUrl).toBe("https://my-service.run.app");
    expect(dispatch.dispatchDeadline).toBe("30m");
    expect(dispatch.oidc?.serviceAccountEmail).toBe("sa@my-proj.iam.gserviceaccount.com");
    expect(dispatch.oidc?.audience).toBe("https://my-service.run.app");
    expect(webhooks[1]!.sync).toBe(true);
    expect(webhooks[1]!.dispatch).toBeUndefined();
    await rm(dir, { recursive: true });
  });

  test("loads dispatch without targetPath (single-path pattern)", async () => {
    const dir = await createTempProject({
      "prepalert.yaml": `
name: test
serve:
  webhooks:
    - path: /webhook/single
      authType: oidc
      issuer: https://accounts.google.com
      audience: https://my-service.run.app
      sync: true
      dispatch:
        type: cloud-tasks
        queue: projects/my-proj/locations/asia-northeast1/queues/prepalert
`,
    });
    const project = await loadProject(dir);
    const dispatch = project.config.serve?.webhooks![0]!.dispatch!;
    expect(dispatch.type).toBe("cloud-tasks");
    expect(dispatch.targetPath).toBeUndefined();
    await rm(dir, { recursive: true });
  });
});

describe("validateWebhooks", () => {
  function makeWebhook(overrides: Partial<WebhookConfig> & { path: string }): WebhookConfig {
    return { authType: "none", ...overrides };
  }

  test("passes valid config", () => {
    const webhooks = [
      makeWebhook({ path: "/webhook/a" }),
      makeWebhook({ path: "/webhook/b", sync: true }),
    ];
    validateWebhooks(webhooks);
  });

  test("passes valid dispatch with targetPath", () => {
    const webhooks = [
      makeWebhook({
        path: "/webhook/gcp",
        dispatch: {
          type: "cloud-tasks",
          queue: "projects/p/locations/l/queues/q",
          targetPath: "/process",
        },
      }),
      makeWebhook({ path: "/process", sync: true }),
    ];
    validateWebhooks(webhooks);
  });

  test("passes single-path dispatch (no targetPath)", () => {
    const webhooks = [
      makeWebhook({
        path: "/webhook/single",
        sync: true,
        dispatch: {
          type: "cloud-tasks",
          queue: "projects/p/locations/l/queues/q",
        },
      }),
    ];
    validateWebhooks(webhooks);
  });

  test("rejects duplicate paths", () => {
    const webhooks = [
      makeWebhook({ path: "/webhook/dup" }),
      makeWebhook({ path: "/webhook/dup" }),
    ];
    expect(() => validateWebhooks(webhooks)).toThrow("duplicate webhook path");
  });

  test("rejects reserved paths", () => {
    const webhooks = [makeWebhook({ path: "/" })];
    expect(() => validateWebhooks(webhooks)).toThrow("reserved path");
  });

  test("rejects /sessions/ as webhook path", () => {
    const webhooks = [makeWebhook({ path: "/sessions/abc" })];
    expect(() => validateWebhooks(webhooks)).toThrow("reserved path");
  });

  test("rejects /auth/ as webhook path", () => {
    const webhooks = [makeWebhook({ path: "/auth/login" })];
    expect(() => validateWebhooks(webhooks)).toThrow("reserved path");
  });

  test("rejects /export/ as webhook path", () => {
    const webhooks = [makeWebhook({ path: "/export/token123" })];
    expect(() => validateWebhooks(webhooks)).toThrow("reserved path");
  });

  test("rejects targetPath referencing undefined webhook", () => {
    const webhooks = [
      makeWebhook({
        path: "/webhook/gcp",
        dispatch: {
          type: "cloud-tasks",
          queue: "projects/p/locations/l/queues/q",
          targetPath: "/nonexistent",
        },
      }),
    ];
    expect(() => validateWebhooks(webhooks)).toThrow("references undefined webhook");
  });

  test("rejects targetPath referencing webhook with dispatch (chaining)", () => {
    const webhooks = [
      makeWebhook({
        path: "/webhook/a",
        dispatch: {
          type: "cloud-tasks",
          queue: "projects/p/locations/l/queues/q",
          targetPath: "/webhook/b",
        },
      }),
      makeWebhook({
        path: "/webhook/b",
        dispatch: {
          type: "cloud-tasks",
          queue: "projects/p/locations/l/queues/q2",
          targetPath: "/process",
        },
      }),
      makeWebhook({ path: "/process", sync: true }),
    ];
    expect(() => validateWebhooks(webhooks)).toThrow("no chaining");
  });

  test("throws when webhook path conflicts with healthCheck path", () => {
    const webhooks: WebhookConfig[] = [
      makeWebhook({ path: "/ping", authType: "none" }),
    ];
    expect(() => validateWebhooks(webhooks, undefined, "/ping")).toThrow("conflicts with healthCheck path");
  });

  test("passes when healthCheck path differs from webhook paths", () => {
    const webhooks: WebhookConfig[] = [
      makeWebhook({ path: "/webhook/test", authType: "none" }),
    ];
    expect(() => validateWebhooks(webhooks, undefined, "/ping")).not.toThrow();
  });

  test("throws when healthCheck path is reserved", () => {
    const webhooks: WebhookConfig[] = [
      makeWebhook({ path: "/webhook/test", authType: "none" }),
    ];
    expect(() => validateWebhooks(webhooks, undefined, "/")).toThrow("reserved path cannot be used as healthCheck path");
  });

  test("passes valid aws-sqs dispatch config", () => {
    const webhooks = [
      makeWebhook({
        path: "/webhook/aws",
        dispatch: {
          type: "aws-sqs",
          queueUrl: "https://sqs.ap-northeast-1.amazonaws.com/123456789012/my-queue",
        },
      }),
    ];
    validateWebhooks(webhooks);
  });

  test("passes aws-sqs dispatch with targetPath", () => {
    const webhooks = [
      makeWebhook({
        path: "/webhook/aws",
        dispatch: {
          type: "aws-sqs",
          queueUrl: "https://sqs.ap-northeast-1.amazonaws.com/123456789012/my-queue",
          targetPath: "/process",
        },
      }),
      makeWebhook({ path: "/process", sync: true }),
    ];
    validateWebhooks(webhooks);
  });

  test("rejects aws-sqs dispatch with missing queueUrl", () => {
    const webhooks = [
      makeWebhook({
        path: "/webhook/aws",
        dispatch: {
          type: "aws-sqs",
          queueUrl: "",
        } as never,
      }),
    ];
    expect(() => validateWebhooks(webhooks)).toThrow("queueUrl is not set");
  });

  test("rejects aws-sqs dispatch chaining", () => {
    const webhooks = [
      makeWebhook({
        path: "/webhook/a",
        dispatch: {
          type: "aws-sqs",
          queueUrl: "https://sqs.ap-northeast-1.amazonaws.com/123456789012/q",
          targetPath: "/webhook/b",
        },
      }),
      makeWebhook({
        path: "/webhook/b",
        dispatch: {
          type: "aws-sqs",
          queueUrl: "https://sqs.ap-northeast-1.amazonaws.com/123456789012/q2",
        },
      }),
    ];
    expect(() => validateWebhooks(webhooks)).toThrow("no chaining");
  });

  test("loads aws-sqs dispatch from yaml", async () => {
    const dir = await createTempProject({
      "prepalert.yaml": `
name: test
serve:
  webhooks:
    - path: /webhook/aws
      authType: none
      dispatch:
        type: aws-sqs
        queueUrl: https://sqs.ap-northeast-1.amazonaws.com/123456789012/my-queue
        targetPath: /process
    - path: /process
      authType: none
      sync: true
`,
    });
    const project = await loadProject(dir);
    const webhooks = project.config.serve?.webhooks!;
    const dispatch = webhooks[0]!.dispatch!;
    expect(dispatch.type).toBe("aws-sqs");
    if (dispatch.type !== "aws-sqs") throw new Error("unexpected type");
    expect(dispatch.queueUrl).toBe("https://sqs.ap-northeast-1.amazonaws.com/123456789012/my-queue");
    expect(dispatch.targetPath).toBe("/process");
    await rm(dir, { recursive: true });
  });
});

describe("createFetchHandler dispatch routing", () => {
  const noopLogger = {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
  };

  let dispatchCalls: { config: DispatchConfig }[] = [];

  const fakeDispatch: DispatchFn = async (config) => {
    dispatchCalls.push({ config });
  };

  afterEach(() => {
    dispatchCalls = [];
  });

  function makeServeContext(webhooks: WebhookConfig[]): ServeContext {
    const webhookMap = new Map<string, WebhookConfig>();
    for (const wh of webhooks) webhookMap.set(wh.path, wh);

    const dir = tmpdir();
    return {
      project: {
        dir,
        config: { name: "test" },
        mcpConfig: { mcpServers: {} },
        runbooks: [],
      } as Project,
      serve: { webhooks },
      webhookMap,
      storage: new LocalSessionStorage(dir),
      remoteStorage: null,
      sessionsDir: dir,
      logger: noopLogger as never,
      healthCheckConfig: { path: "/health", contentType: "application/json", idle: { status: 200, body: "ok" }, busy: { status: 200, body: "busy" } },
      exportSecret: new Uint8Array(32),
      oidcConfig: null,
      handleSpaRequest: () => null,
      stats: { activeRequests: 0, totalRequests: 0, startTime: Date.now() },
      dispatch: fakeDispatch,
    };
  }

  test("webhook with cloud-tasks dispatch returns 202 when no dispatched header", async () => {
    const ctx = makeServeContext([
      {
        path: "/webhook/alert",
        authType: "none",
        dispatch: {
          type: "cloud-tasks",
          queue: "projects/p/locations/l/queues/q",
          baseUrl: "https://my-service.run.app",
        },
      },
    ]);
    const handler = createFetchHandler(ctx);
    const request = new Request("http://localhost:8080/webhook/alert", {
      method: "POST",
      body: '{"alert":"test"}',
    });

    const response = await handler(request);
    expect(response.status).toBe(202);
    expect(dispatchCalls.length).toBe(1);
    expect(dispatchCalls[0]!.config.type).toBe("cloud-tasks");
  });

  test("webhook with aws-sqs dispatch returns 202 when no dispatched header", async () => {
    const ctx = makeServeContext([
      {
        path: "/webhook/alert",
        authType: "none",
        dispatch: {
          type: "aws-sqs",
          queueUrl: "https://sqs.us-east-1.amazonaws.com/123/q",
        },
      },
    ]);
    const handler = createFetchHandler(ctx);
    const request = new Request("http://localhost:8080/webhook/alert", {
      method: "POST",
      body: '{"alert":"test"}',
    });

    const response = await handler(request);
    expect(response.status).toBe(202);
    expect(dispatchCalls.length).toBe(1);
    expect(dispatchCalls[0]!.config.type).toBe("aws-sqs");
  });

});
