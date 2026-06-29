import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import { DISPATCH_TOKEN_HEADER } from "./dispatch-token.js";
import type { APIGatewayProxyEventV2 } from "./lambda.js";
import type { SqsDispatchConfig } from "./project.js";
import type { Logger } from "./logger.js";

const SQS_MAX_MESSAGE_SIZE = 262144;

let cachedClient: SQSClient | undefined;

function getClient(): SQSClient {
  if (!cachedClient) {
    cachedClient = new SQSClient({});
  }
  return cachedClient;
}

/**
 * Convert an incoming HTTP request to an API Gateway v2 event for SQS payload.
 * When targetPath is specified, rawPath is overridden accordingly.
 */
export function requestToAPIGatewayV2Event(
  request: Request,
  body: string,
  baseUrl: string,
  dispatchToken: string,
  targetPath?: string | undefined,
): APIGatewayProxyEventV2 {
  const url = new URL(request.url);
  const effectivePath = targetPath ?? url.pathname;
  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    headers[key] = value;
  });
  headers[DISPATCH_TOKEN_HEADER] = dispatchToken;

  const hostname = new URL(baseUrl).hostname;

  return {
    version: "2.0",
    routeKey: `${request.method} ${effectivePath}`,
    rawPath: effectivePath,
    rawQueryString: url.search.replace(/^\?/, ""),
    headers,
    requestContext: {
      accountId: "",
      apiId: "",
      domainPrefix: "",
      http: {
        method: request.method,
        path: effectivePath,
        protocol: "HTTP/1.1",
        sourceIp: (request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "127.0.0.1"),
        userAgent: request.headers.get("user-agent") ?? "",
      },
      domainName: hostname,
      routeKey: `${request.method} ${effectivePath}`,
      stage: "$default",
      requestId: crypto.randomUUID(),
      time: new Date().toISOString(),
      timeEpoch: Date.now(),
    },
    body,
    isBase64Encoded: false,
  };
}

export interface SendToSqsParams {
  config: SqsDispatchConfig;
  request: Request;
  body: string;
  dispatchToken: string;
  logger: Logger;
  client?: { send: SQSClient["send"] } | undefined;
}

export async function sendToSqs(params: SendToSqsParams): Promise<void> {
  const { config, request, body, dispatchToken, logger } = params;
  const client = params.client ?? getClient();

  const baseUrl = config.baseUrl
    ?? `${request.headers.get("x-forwarded-proto") ?? "https"}://${request.headers.get("host") ?? "localhost"}`;

  const event = requestToAPIGatewayV2Event(request, body, baseUrl, dispatchToken, config.targetPath);
  const messageBody = JSON.stringify(event);

  const messageBytes = new TextEncoder().encode(messageBody).byteLength;
  if (messageBytes > SQS_MAX_MESSAGE_SIZE) {
    throw new Error(
      `SQS message size ${messageBytes} bytes exceeds the ${SQS_MAX_MESSAGE_SIZE} byte limit`,
    );
  }

  try {
    const command = new SendMessageCommand({
      QueueUrl: config.queueUrl,
      MessageBody: messageBody,
    });
    const result = await client.send(command);
    logger.info("SQS message sent", {
      queueUrl: config.queueUrl,
      messageId: result.MessageId,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error("failed to send SQS message", {
      queueUrl: config.queueUrl,
      error: msg,
    });
    throw e;
  }
}

export function resetClient(): void {
  cachedClient = undefined;
}
