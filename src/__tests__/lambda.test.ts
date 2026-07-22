import { describe, test, expect, afterEach } from "bun:test";
import { mkdtemp, mkdir, writeFile, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import {
  isLambdaEnvironment,
  isSQSEvent,
  isAPIGatewayV2Event,
  apiGatewayV2EventToRequest,
  responseToAPIGatewayV2,
  stageProjectDirForLambda,
  type APIGatewayV2Event,
  type SQSEvent,
} from "../lambda.js";

function makeAPIGatewayV2Event(overrides: Partial<APIGatewayV2Event> = {}): APIGatewayV2Event {
  return {
    version: "2.0",
    routeKey: "POST /webhook/test",
    rawPath: "/webhook/test",
    rawQueryString: "",
    headers: {
      "content-type": "application/json",
      host: "example.com",
    },
    requestContext: {
      http: {
        method: "POST",
        path: "/webhook/test",
        protocol: "HTTP/1.1",
        sourceIp: "203.0.113.1",
        userAgent: "test-agent",
      },
      domainName: "example.com",
      stage: "$default",
      requestId: "test-request-id",
      time: "2025-01-01T00:00:00.000Z",
      timeEpoch: 1735689600000,
    },
    body: '{"alert":"test"}',
    isBase64Encoded: false,
    ...overrides,
  };
}

function makeSQSEvent(bodies: string[]): SQSEvent {
  return {
    Records: bodies.map((body, i) => ({
      messageId: `msg-${i}`,
      receiptHandle: `handle-${i}`,
      body,
      attributes: {},
      messageAttributes: {},
      md5OfBody: "",
      eventSource: "aws:sqs" as const,
      eventSourceARN: "arn:aws:sqs:ap-northeast-1:123456789012:test-queue",
      awsRegion: "ap-northeast-1",
    })),
  };
}

describe("isLambdaEnvironment", () => {
  test("returns false when AWS_LAMBDA_FUNCTION_NAME is not set", () => {
    delete process.env["AWS_LAMBDA_FUNCTION_NAME"];
    expect(isLambdaEnvironment()).toBe(false);
  });

  test("returns true when AWS_LAMBDA_FUNCTION_NAME is set", () => {
    process.env["AWS_LAMBDA_FUNCTION_NAME"] = "my-function";
    expect(isLambdaEnvironment()).toBe(true);
    delete process.env["AWS_LAMBDA_FUNCTION_NAME"];
  });
});

describe("isSQSEvent", () => {
  test("returns true for valid SQS event", () => {
    const event = makeSQSEvent(['{"test": true}']);
    expect(isSQSEvent(event)).toBe(true);
  });

  test("returns false for API Gateway v2 event", () => {
    const event = makeAPIGatewayV2Event();
    expect(isSQSEvent(event)).toBe(false);
  });

  test("returns false for null", () => {
    expect(isSQSEvent(null)).toBe(false);
  });

  test("returns false for empty Records array", () => {
    expect(isSQSEvent({ Records: [] })).toBe(false);
  });

  test("returns false for Records with non-SQS event source", () => {
    expect(isSQSEvent({ Records: [{ eventSource: "aws:s3" }] })).toBe(false);
  });
});

describe("isAPIGatewayV2Event", () => {
  test("returns true for valid API Gateway v2 event", () => {
    const event = makeAPIGatewayV2Event();
    expect(isAPIGatewayV2Event(event)).toBe(true);
  });

  test("returns false for SQS event", () => {
    const event = makeSQSEvent(['{"test": true}']);
    expect(isAPIGatewayV2Event(event)).toBe(false);
  });

  test("returns false for version 1.0", () => {
    expect(isAPIGatewayV2Event({ version: "1.0", requestContext: {} })).toBe(false);
  });

  test("returns false for null", () => {
    expect(isAPIGatewayV2Event(null)).toBe(false);
  });

  test("returns false for object without requestContext", () => {
    expect(isAPIGatewayV2Event({ version: "2.0" })).toBe(false);
  });
});

describe("apiGatewayV2EventToRequest", () => {
  test("converts basic POST event to Request", () => {
    const event = makeAPIGatewayV2Event();
    const request = apiGatewayV2EventToRequest(event);

    expect(request.method).toBe("POST");
    expect(request.url).toBe("https://example.com/webhook/test");
    expect(request.headers.get("content-type")).toBe("application/json");
    expect(request.headers.get("host")).toBe("example.com");
  });

  test("includes query string when present", () => {
    const event = makeAPIGatewayV2Event({ rawQueryString: "key=value&foo=bar" });
    const request = apiGatewayV2EventToRequest(event);

    expect(request.url).toBe("https://example.com/webhook/test?key=value&foo=bar");
  });

  test("handles empty query string", () => {
    const event = makeAPIGatewayV2Event({ rawQueryString: "" });
    const request = apiGatewayV2EventToRequest(event);

    expect(request.url).toBe("https://example.com/webhook/test");
  });

  test("includes body for POST requests", async () => {
    const event = makeAPIGatewayV2Event({ body: '{"alert":"fired"}' });
    const request = apiGatewayV2EventToRequest(event);

    expect(await request.text()).toBe('{"alert":"fired"}');
  });

  test("restores cookies array into Cookie header", () => {
    const event = makeAPIGatewayV2Event({ cookies: ["a=1", "b=2"] });
    const request = apiGatewayV2EventToRequest(event);

    expect(request.headers.get("cookie")).toBe("a=1; b=2");
  });

  test("omits Cookie header when no cookies present", () => {
    const event = makeAPIGatewayV2Event();
    const request = apiGatewayV2EventToRequest(event);

    expect(request.headers.get("cookie")).toBeNull();
  });

  test("decodes base64 body when isBase64Encoded is true", async () => {
    const originalBody = "hello binary world";
    const base64Body = Buffer.from(originalBody).toString("base64");
    const event = makeAPIGatewayV2Event({
      body: base64Body,
      isBase64Encoded: true,
    });
    const request = apiGatewayV2EventToRequest(event);

    const bodyBuffer = await request.arrayBuffer();
    expect(Buffer.from(bodyBuffer).toString()).toBe(originalBody);
  });

  test("does not include body for GET requests", async () => {
    const event = makeAPIGatewayV2Event({
      body: "should-be-ignored",
      requestContext: {
        ...makeAPIGatewayV2Event().requestContext,
        http: {
          ...makeAPIGatewayV2Event().requestContext.http,
          method: "GET",
        },
      },
    });
    const request = apiGatewayV2EventToRequest(event);

    expect(request.method).toBe("GET");
    expect(request.body).toBeNull();
  });

  test("handles undefined body", async () => {
    const event = makeAPIGatewayV2Event({ body: undefined });
    const request = apiGatewayV2EventToRequest(event);

    expect(request.body).toBeNull();
  });

  test("skips undefined header values", () => {
    const event = makeAPIGatewayV2Event({
      headers: {
        "content-type": "application/json",
        "x-custom": undefined,
      },
    });
    const request = apiGatewayV2EventToRequest(event);

    expect(request.headers.get("content-type")).toBe("application/json");
    expect(request.headers.has("x-custom")).toBe(false);
  });

  test("resolves scheme and host case-insensitively", () => {
    const event = makeAPIGatewayV2Event({
      headers: {
        "Content-Type": "application/json",
        "X-Forwarded-Proto": "http",
        Host: "upper-case.example.com",
      },
    });
    const request = apiGatewayV2EventToRequest(event);

    expect(request.url).toBe("http://upper-case.example.com/webhook/test");
  });
});

describe("responseToAPIGatewayV2", () => {
  test("converts basic Response", async () => {
    const response = new Response("OK", {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });
    const result = await responseToAPIGatewayV2(response);

    expect(result.statusCode).toBe(200);
    expect(result.body).toBe("OK");
    expect(result.headers?.["content-type"]).toBe("text/plain");
    expect(result.isBase64Encoded).toBe(false);
  });

  test("converts JSON Response", async () => {
    const response = new Response(JSON.stringify({ status: "accepted" }), {
      status: 202,
      headers: { "Content-Type": "application/json" },
    });
    const result = await responseToAPIGatewayV2(response);

    expect(result.statusCode).toBe(202);
    expect(JSON.parse(result.body!)).toEqual({ status: "accepted" });
  });

  test("handles empty body", async () => {
    const response = new Response(null, { status: 204 });
    const result = await responseToAPIGatewayV2(response);

    expect(result.statusCode).toBe(204);
    expect(result.body).toBe("");
  });

  test("preserves multiple Set-Cookie headers as separate cookies", async () => {
    const response = new Response(null, {
      status: 302,
      headers: [
        ["Location", "/"],
        ["Set-Cookie", "a=1; Path=/"],
        ["Set-Cookie", "b=2; Path=/"],
      ],
    });
    const result = await responseToAPIGatewayV2(response);

    expect(result.cookies).toEqual(["a=1; Path=/", "b=2; Path=/"]);
    expect(result.headers?.["set-cookie"]).toBeUndefined();
    expect(result.headers?.["location"]).toBe("/");
  });
});

describe("SQS event with API Gateway v2 payload integration", () => {
  test("SQS record body containing API Gateway v2 event can be parsed and converted", () => {
    const innerEvent = makeAPIGatewayV2Event({
      headers: {
        "content-type": "application/json",
        "prepalert-dispatch-token": "tok",
        host: "example.com",
      },
    });
    const sqsEvent = makeSQSEvent([JSON.stringify(innerEvent)]);

    expect(isSQSEvent(sqsEvent)).toBe(true);
    expect(isAPIGatewayV2Event(sqsEvent)).toBe(false);

    const record = sqsEvent.Records[0]!;
    const parsed: unknown = JSON.parse(record.body);
    expect(isAPIGatewayV2Event(parsed)).toBe(true);

    const request = apiGatewayV2EventToRequest(parsed as APIGatewayV2Event);
    expect(request.method).toBe("POST");
    expect(request.url).toBe("https://example.com/webhook/test");
    expect(request.headers.get("prepalert-dispatch-token")).toBe("tok");
  });
});

describe("stageProjectDirForLambda", () => {
  const STAGED_DIR = "/tmp/prepalert-project";

  afterEach(async () => {
    await rm(STAGED_DIR, { recursive: true, force: true });
  });

  test("returns the input unchanged when already under /tmp", async () => {
    const dir = await mkdtemp("/tmp/prepalert-lambda-test-");
    try {
      expect(await stageProjectDirForLambda(dir)).toBe(dir);
      expect(await stageProjectDirForLambda("/tmp")).toBe("/tmp");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("copies the project directory into /tmp and returns the staged path", async () => {
    const source = await mkdtemp(join(process.cwd(), ".prepalert-lambda-source-"));
    try {
      await writeFile(join(source, "prepalert.yaml"), "name: test\n");
      await mkdir(join(source, "runbooks"), { recursive: true });
      await writeFile(join(source, "runbooks", "example.md"), "# Runbook\n");

      const staged = await stageProjectDirForLambda(source);

      expect(staged).toBe(STAGED_DIR);
      expect(await readFile(join(staged, "prepalert.yaml"), "utf-8")).toBe("name: test\n");
      expect(await readFile(join(staged, "runbooks", "example.md"), "utf-8")).toBe("# Runbook\n");
    } finally {
      await rm(source, { recursive: true, force: true });
    }
  });

  test("overwrites a previously staged directory", async () => {
    const first = await mkdtemp(join(process.cwd(), ".prepalert-lambda-first-"));
    const second = await mkdtemp(join(process.cwd(), ".prepalert-lambda-second-"));
    try {
      await writeFile(join(first, "prepalert.yaml"), "name: first\n");
      await writeFile(join(first, "only-in-first.txt"), "stale\n");
      await writeFile(join(second, "prepalert.yaml"), "name: second\n");

      await stageProjectDirForLambda(first);
      const staged = await stageProjectDirForLambda(second);

      expect(await readFile(join(staged, "prepalert.yaml"), "utf-8")).toBe("name: second\n");
      await expect(stat(join(staged, "only-in-first.txt"))).rejects.toThrow();
    } finally {
      await rm(first, { recursive: true, force: true });
      await rm(second, { recursive: true, force: true });
    }
  });
});
