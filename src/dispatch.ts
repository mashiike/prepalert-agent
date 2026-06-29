import type { CloudTasksClient, protos } from "@google-cloud/tasks";
import { parseDuration } from "./config.js";
import type { CloudTasksDispatchConfig } from "./project.js";
import type { Logger } from "./logger.js";

type ITask = protos.google.cloud.tasks.v2.ITask;
type IHttpRequest = protos.google.cloud.tasks.v2.IHttpRequest;

const CLOUD_TASKS_HEADER = "x-cloudtasks-taskname";
export const DISPATCHED_HEADER = "x-prepalert-dispatched";

const METADATA_SA_URL =
  "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/email";

let cachedClient: CloudTasksClient | undefined;

async function getClient(): Promise<CloudTasksClient> {
  if (!cachedClient) {
    const { CloudTasksClient } = await import("@google-cloud/tasks");
    cachedClient = new CloudTasksClient();
  }
  return cachedClient;
}

/**
 * Detect whether an incoming request was dispatched (Cloud Tasks, SQS, etc.).
 * Checks both the Cloud Tasks native header and the generic dispatched header
 * to prevent infinite dispatch loops in single-path patterns.
 */
export function isDispatchedRequest(request: Request): boolean {
  return request.headers.has(CLOUD_TASKS_HEADER) || request.headers.has(DISPATCHED_HEADER);
}

/**
 * Resolve the base URL for task HTTP targets from explicit config or request headers.
 */
export function resolveBaseUrl(
  config: CloudTasksDispatchConfig,
  request: Request,
): string {
  if (config.baseUrl) {
    return config.baseUrl.replace(/\/$/, "");
  }
  const proto = request.headers.get("x-forwarded-proto") ?? "http";
  const host = request.headers.get("host");
  if (!host) {
    throw new Error(
      "Cannot resolve baseUrl: no Host header and dispatch.baseUrl not configured",
    );
  }
  return `${proto}://${host}`;
}

async function resolveServiceAccountEmail(
  config: CloudTasksDispatchConfig,
  logger: Logger,
): Promise<string | undefined> {
  if (config.oidc?.serviceAccountEmail) {
    return config.oidc.serviceAccountEmail;
  }
  try {
    const response = await fetch(METADATA_SA_URL, {
      headers: { "Metadata-Flavor": "Google" },
      signal: AbortSignal.timeout(3000),
    });
    if (response.ok) {
      return (await response.text()).trim();
    }
  } catch {
    logger.debug("metadata server not available for service account email");
  }
  return undefined;
}

/**
 * Resolve the dispatch deadline in seconds.
 * Priority: dispatch.dispatchDeadline > project timeout > undefined (warn emitted at startup validation)
 */
const CLOUD_TASKS_MIN_DEADLINE = 15;
const CLOUD_TASKS_MAX_DEADLINE = 1800;

export function resolveDispatchDeadlineSeconds(
  dispatchDeadline: string | undefined,
  projectTimeout: string | undefined,
): number | undefined {
  let seconds: number | undefined;
  if (dispatchDeadline) {
    seconds = Math.ceil(parseDuration(dispatchDeadline));
  } else if (projectTimeout) {
    seconds = Math.ceil(parseDuration(projectTimeout));
  }
  if (seconds === undefined) return undefined;
  return Math.max(CLOUD_TASKS_MIN_DEADLINE, Math.min(seconds, CLOUD_TASKS_MAX_DEADLINE));
}

export interface CreateTaskParams {
  config: CloudTasksDispatchConfig;
  request: Request;
  body: string;
  projectTimeout: string | undefined;
  logger: Logger;
  client?: { createTask: CloudTasksClient["createTask"] } | undefined;
}

/**
 * Create a Cloud Tasks HTTP task that calls back the target endpoint.
 */
export async function createCloudTask(params: CreateTaskParams): Promise<void> {
  const { config, request, body, projectTimeout, logger } = params;
  const client = params.client ?? (await getClient());
  const baseUrl = resolveBaseUrl(config, request);
  const targetPath = config.targetPath ?? new URL(request.url).pathname;
  const url = `${baseUrl}${targetPath}`;

  const deadlineSeconds = resolveDispatchDeadlineSeconds(
    config.dispatchDeadline,
    projectTimeout,
  );

  const httpRequest: IHttpRequest = {
    httpMethod: "POST",
    url,
    headers: {
      "Content-Type": "application/json",
      [DISPATCHED_HEADER]: "true",
    },
    body: Buffer.from(body),
  };

  const serviceAccountEmail = await resolveServiceAccountEmail(config, logger);
  if (serviceAccountEmail) {
    const audience = config.oidc?.audience ?? baseUrl;
    httpRequest.oidcToken = { serviceAccountEmail, audience };
  }

  const task: ITask = { httpRequest };
  if (deadlineSeconds !== undefined) {
    task.dispatchDeadline = { seconds: deadlineSeconds };
  }

  try {
    const [response] = await client.createTask({ parent: config.queue, task });
    logger.info("cloud task created", {
      queue: config.queue,
      taskName: response.name,
      targetUrl: url,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    logger.error("failed to create cloud task", {
      queue: config.queue,
      targetUrl: url,
      error: message,
    });
    throw e;
  }
}

/**
 * Reset the cached client (for testing).
 */
export function resetClient(): void {
  cachedClient = undefined;
}
