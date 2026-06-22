import { parseDuration } from "./config.js";
import type { Logger } from "./logger.js";

function getAgentUri(): string | undefined {
  return process.env["ECS_AGENT_URI"];
}

export function isEcsEnvironment(): boolean {
  return getAgentUri() !== undefined;
}

export async function enableTaskProtection(timeout: string | undefined, logger: Logger): Promise<void> {
  const agentUri = getAgentUri();
  if (!agentUri) return;

  let expiresInMinutes = 120;
  if (timeout) {
    const seconds = parseDuration(timeout);
    expiresInMinutes = Math.ceil(seconds / 60);
  }

  const url = `${agentUri}/task-protection/v1/state`;
  const response = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ProtectionEnabled: true,
      ExpiresInMinutes: expiresInMinutes,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    logger.error("Failed to enable ECS task protection", { status: response.status, body });
  }
}

export async function disableTaskProtection(logger: Logger): Promise<void> {
  const agentUri = getAgentUri();
  if (!agentUri) return;

  const url = `${agentUri}/task-protection/v1/state`;
  const response = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ProtectionEnabled: false }),
  });

  if (!response.ok) {
    const body = await response.text();
    logger.error("Failed to disable ECS task protection", { status: response.status, body });
  }
}
