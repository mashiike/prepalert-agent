import { describe, test, expect } from "bun:test";
import { requestToAPIGatewayV2Event, sendToSqs } from "../sqs-dispatch.js";

function makeRequest(url: string, opts: { method?: string; headers?: Record<string, string>; body?: string } = {}): Request {
  return new Request(url, {
    method: opts.method ?? "POST",
    headers: opts.headers ?? { "content-type": "application/json" },
    body: opts.body ?? '{"alert":"test"}',
  });
}

describe("requestToAPIGatewayV2Event", () => {
  test("converts basic POST request", () => {
    const request = makeRequest("http://localhost:8080/webhook/mackerel");
    const event = requestToAPIGatewayV2Event(request, '{"alert":"test"}', "https://example.com");

    expect(event.version).toBe("2.0");
    expect(event.rawPath).toBe("/webhook/mackerel");
    expect(event.requestContext.http.method).toBe("POST");
    expect(event.requestContext.http.path).toBe("/webhook/mackerel");
    expect(event.requestContext.domainName).toBe("example.com");
    expect(event.body).toBe('{"alert":"test"}');
    expect(event.isBase64Encoded).toBe(false);
  });

  test("includes x-prepalert-dispatched header", () => {
    const request = makeRequest("http://localhost:8080/webhook/test");
    const event = requestToAPIGatewayV2Event(request, "", "https://example.com");

    expect(event.headers["x-prepalert-dispatched"]).toBe("true");
  });

  test("preserves original request headers", () => {
    const request = makeRequest("http://localhost:8080/webhook/test", {
      headers: {
        "content-type": "application/json",
        "x-custom-header": "custom-value",
      },
    });
    const event = requestToAPIGatewayV2Event(request, "", "https://example.com");

    expect(event.headers["content-type"]).toBe("application/json");
    expect(event.headers["x-custom-header"]).toBe("custom-value");
  });

  test("uses targetPath when provided", () => {
    const request = makeRequest("http://localhost:8080/webhook/mackerel");
    const event = requestToAPIGatewayV2Event(request, "", "https://example.com", "/internal/process");

    expect(event.rawPath).toBe("/internal/process");
    expect(event.requestContext.http.path).toBe("/internal/process");
    expect(event.routeKey).toBe("POST /internal/process");
  });

  test("uses original path when targetPath is undefined", () => {
    const request = makeRequest("http://localhost:8080/webhook/mackerel");
    const event = requestToAPIGatewayV2Event(request, "", "https://example.com", undefined);

    expect(event.rawPath).toBe("/webhook/mackerel");
  });

  test("handles query string", () => {
    const request = makeRequest("http://localhost:8080/webhook/test?key=value&foo=bar");
    const event = requestToAPIGatewayV2Event(request, "", "https://example.com");

    expect(event.rawQueryString).toBe("key=value&foo=bar");
  });

  test("handles empty query string", () => {
    const request = makeRequest("http://localhost:8080/webhook/test");
    const event = requestToAPIGatewayV2Event(request, "", "https://example.com");

    expect(event.rawQueryString).toBe("");
  });

  test("extracts sourceIp from x-forwarded-for header", () => {
    const request = makeRequest("http://localhost:8080/webhook/test", {
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": "10.0.0.1",
      },
    });
    const event = requestToAPIGatewayV2Event(request, "", "https://example.com");

    expect(event.requestContext.http.sourceIp).toBe("10.0.0.1");
  });

  test("extracts first IP from comma-separated x-forwarded-for", () => {
    const request = makeRequest("http://localhost:8080/webhook/test", {
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": "10.0.0.1, 192.168.1.1, 172.16.0.1",
      },
    });
    const event = requestToAPIGatewayV2Event(request, "", "https://example.com");

    expect(event.requestContext.http.sourceIp).toBe("10.0.0.1");
  });

  test("uses 127.0.0.1 as default sourceIp", () => {
    const request = makeRequest("http://localhost:8080/webhook/test");
    const event = requestToAPIGatewayV2Event(request, "", "https://example.com");

    expect(event.requestContext.http.sourceIp).toBe("127.0.0.1");
  });

  test("generates unique requestId", () => {
    const request = makeRequest("http://localhost:8080/webhook/test");
    const event1 = requestToAPIGatewayV2Event(request, "", "https://example.com");
    const event2 = requestToAPIGatewayV2Event(request, "", "https://example.com");

    expect(event1.requestContext.requestId).not.toBe(event2.requestContext.requestId);
  });

  test("produces valid JSON that can be parsed back as API Gateway v2 event", () => {
    const request = makeRequest("http://localhost:8080/webhook/mackerel", {
      headers: {
        "content-type": "application/json",
        "x-custom": "value",
      },
      body: '{"alert":"fired","severity":"critical"}',
    });
    const event = requestToAPIGatewayV2Event(
      request,
      '{"alert":"fired","severity":"critical"}',
      "https://my-lambda.example.com",
    );

    const serialized = JSON.stringify(event);
    const deserialized = JSON.parse(serialized);

    expect(deserialized.version).toBe("2.0");
    expect(deserialized.rawPath).toBe("/webhook/mackerel");
    expect(deserialized.body).toBe('{"alert":"fired","severity":"critical"}');
    expect(deserialized.headers["x-prepalert-dispatched"]).toBe("true");
    expect(deserialized.requestContext.domainName).toBe("my-lambda.example.com");
  });
});

describe("sendToSqs", () => {
  const noopLogger = {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
  };

  test("throws when message exceeds SQS size limit", async () => {
    const request = makeRequest("http://localhost:8080/webhook/test");
    const largeBody = "x".repeat(300000);
    await expect(
      sendToSqs({
        config: { type: "aws-sqs", queueUrl: "https://sqs.us-east-1.amazonaws.com/123/q" },
        request,
        body: largeBody,
        logger: noopLogger as never,
      }),
    ).rejects.toThrow("exceeds the 262144 byte limit");
  });
});
