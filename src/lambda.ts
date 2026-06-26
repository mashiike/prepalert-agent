import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
  SQSEvent as AWSSQSEvent,
  SQSBatchResponse,
} from "aws-lambda";
import type { Logger } from "./logger.js";

export type { APIGatewayProxyEventV2 } from "aws-lambda";

export function isLambdaEnvironment(): boolean {
  return process.env["AWS_LAMBDA_FUNCTION_NAME"] !== undefined;
}

export function isSQSEvent(event: unknown): event is AWSSQSEvent {
  if (event === null || typeof event !== "object") return false;
  const candidate = event as Record<string, unknown>;
  if (!Array.isArray(candidate["Records"])) return false;
  const records = candidate["Records"] as unknown[];
  if (records.length === 0) return false;
  const first = records[0];
  if (first === null || typeof first !== "object") return false;
  return (first as Record<string, unknown>)["eventSource"] === "aws:sqs";
}

export function isAPIGatewayV2Event(event: unknown): event is APIGatewayProxyEventV2 {
  if (event === null || typeof event !== "object") return false;
  const candidate = event as Record<string, unknown>;
  return candidate["version"] === "2.0" && "requestContext" in candidate;
}

export function apiGatewayV2EventToRequest(event: APIGatewayProxyEventV2): Request {
  const domain = event.requestContext.domainName;
  const qs = event.rawQueryString ? `?${event.rawQueryString}` : "";
  const url = `https://${domain}${event.rawPath}${qs}`;

  const headers = new Headers();
  if (event.headers) {
    for (const [key, value] of Object.entries(event.headers)) {
      if (value !== undefined) {
        headers.set(key, value);
      }
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

export async function responseToAPIGatewayV2(response: Response): Promise<APIGatewayProxyStructuredResultV2> {
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
  const result: APIGatewayProxyStructuredResultV2 = {
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
        const batchResponse: SQSBatchResponse = {
          batchItemFailures: failures.map(id => ({ itemIdentifier: id })),
        };
        responseBody = JSON.stringify(batchResponse);
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
