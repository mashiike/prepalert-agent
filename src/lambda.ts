import type { Logger } from "./logger.js";

export interface APIGatewayV2Event {
  version: "2.0";
  routeKey: string;
  rawPath: string;
  rawQueryString: string;
  headers: Record<string, string | undefined>;
  queryStringParameters?: Record<string, string | undefined> | undefined;
  requestContext: {
    http: {
      method: string;
      path: string;
      protocol: string;
      sourceIp: string;
      userAgent: string;
    };
    domainName: string;
    stage: string;
    requestId: string;
    time: string;
    timeEpoch: number;
  };
  body?: string | undefined;
  isBase64Encoded: boolean;
}

export interface SQSRecord {
  messageId: string;
  receiptHandle: string;
  body: string;
  attributes: Record<string, string>;
  messageAttributes: Record<string, unknown>;
  md5OfBody: string;
  eventSource: "aws:sqs";
  eventSourceARN: string;
  awsRegion: string;
}

export interface SQSEvent {
  Records: SQSRecord[];
}

export interface APIGatewayV2Response {
  statusCode: number;
  headers?: Record<string, string> | undefined;
  cookies?: string[] | undefined;
  body?: string | undefined;
  isBase64Encoded?: boolean | undefined;
}

export function isLambdaEnvironment(): boolean {
  return process.env["AWS_LAMBDA_FUNCTION_NAME"] !== undefined;
}

export function isSQSEvent(event: unknown): event is SQSEvent {
  if (event === null || typeof event !== "object") return false;
  const candidate = event as Record<string, unknown>;
  if (!Array.isArray(candidate["Records"])) return false;
  const records = candidate["Records"] as unknown[];
  if (records.length === 0) return false;
  const first = records[0];
  if (first === null || typeof first !== "object") return false;
  return (first as Record<string, unknown>)["eventSource"] === "aws:sqs";
}

export function isAPIGatewayV2Event(event: unknown): event is APIGatewayV2Event {
  if (event === null || typeof event !== "object") return false;
  const candidate = event as Record<string, unknown>;
  return candidate["version"] === "2.0" && "requestContext" in candidate;
}

export function apiGatewayV2EventToRequest(event: APIGatewayV2Event): Request {
  const domain = event.requestContext.domainName;
  const qs = event.rawQueryString ? `?${event.rawQueryString}` : "";
  const url = `https://${domain}${event.rawPath}${qs}`;

  const headers = new Headers();
  for (const [key, value] of Object.entries(event.headers)) {
    if (value !== undefined) {
      headers.set(key, value);
    }
  }

  const method = event.requestContext.http.method;
  let body: string | Buffer | undefined;
  if (event.body !== undefined) {
    body = event.isBase64Encoded ? Buffer.from(event.body, "base64") : event.body;
  }

  return new Request(url, {
    method,
    headers,
    body: method === "GET" || method === "HEAD" ? undefined : body,
  });
}

export async function responseToAPIGatewayV2(response: Response): Promise<APIGatewayV2Response> {
  const headers: Record<string, string> = {};
  const cookies: string[] = [];
  response.headers.forEach((value, key) => {
    if (key.toLowerCase() === "set-cookie") {
      cookies.push(value);
    } else {
      headers[key] = value;
    }
  });
  const body = await response.text();
  const result: APIGatewayV2Response = {
    statusCode: response.status,
    headers,
    body,
    isBase64Encoded: false,
  };
  if (cookies.length > 0) result.cookies = cookies;
  return result;
}

/**
 * Start the Lambda custom runtime loop.
 * Polls the Lambda Runtime API for invocations and dispatches them to the handler.
 */
export async function startLambdaRuntime(
  handler: (request: Request) => Promise<Response>,
  logger: Logger,
): Promise<never> {
  const runtimeApi = process.env["AWS_LAMBDA_RUNTIME_API"];
  if (!runtimeApi) {
    throw new Error("AWS_LAMBDA_RUNTIME_API not set");
  }
  const baseUrl = `http://${runtimeApi}/2018-06-01/runtime`;

  while (true) {
    let nextResponse: Response;
    try {
      nextResponse = await fetch(`${baseUrl}/invocation/next`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.error("failed to fetch next invocation from Lambda Runtime API", { error: msg });
      await new Promise(r => setTimeout(r, 1000));
      continue;
    }
    if (!nextResponse.ok) {
      logger.error("Lambda Runtime API /invocation/next returned non-OK status", { status: nextResponse.status });
      await new Promise(r => setTimeout(r, 1000));
      continue;
    }

    const requestId = nextResponse.headers.get("lambda-runtime-aws-request-id");
    if (!requestId) {
      logger.error("missing request id from Lambda Runtime API");
      continue;
    }

    try {
      const event: unknown = await nextResponse.json();
      let responseBody: string;

      if (isSQSEvent(event)) {
        const failures: string[] = [];
        for (const record of event.Records) {
          try {
            const innerEvent: unknown = JSON.parse(record.body);
            if (!isAPIGatewayV2Event(innerEvent)) {
              logger.error("SQS record body is not a valid API Gateway v2 event", { messageId: record.messageId });
              failures.push(record.messageId);
              continue;
            }
            const request = apiGatewayV2EventToRequest(innerEvent);
            const response = await handler(request);
            if (!response.ok) {
              logger.error("SQS record handler returned non-OK status", { messageId: record.messageId, status: response.status });
              failures.push(record.messageId);
              continue;
            }
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            logger.error("SQS record processing failed", { messageId: record.messageId, error: msg });
            failures.push(record.messageId);
          }
        }
        responseBody = JSON.stringify({
          batchItemFailures: failures.map(id => ({ itemIdentifier: id })),
        });
      } else if (isAPIGatewayV2Event(event)) {
        const request = apiGatewayV2EventToRequest(event);
        const httpResponse = await handler(request);
        const apiResponse = await responseToAPIGatewayV2(httpResponse);
        responseBody = JSON.stringify(apiResponse);
      } else {
        const preview = typeof event === "object" && event !== null
          ? JSON.stringify(event).slice(0, 200)
          : String(event);
        logger.error("unsupported Lambda event type", { event: preview });
        responseBody = JSON.stringify({ statusCode: 400, body: "Unsupported event type" });
      }

      const successResp = await fetch(`${baseUrl}/invocation/${requestId}/response`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: responseBody,
      });
      if (!successResp.ok) {
        logger.error("failed to post invocation response", { requestId, status: successResp.status });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.error("Lambda invocation failed", { requestId, error: msg });
      try {
        const errorResp = await fetch(`${baseUrl}/invocation/${requestId}/error`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            errorMessage: msg,
            errorType: "HandlerError",
          }),
        });
        if (!errorResp.ok) {
          logger.error("failed to post invocation error", { requestId, status: errorResp.status });
        }
      } catch (reportErr) {
        const reportMsg = reportErr instanceof Error ? reportErr.message : String(reportErr);
        logger.error("failed to report invocation error to Lambda Runtime API", { requestId, error: reportMsg });
      }
    }
  }
}
