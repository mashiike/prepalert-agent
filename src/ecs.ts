import { parseDuration } from "./config.js";
import type { Logger } from "./logger.js";

const ECS_TASK_PROTECTION_MAX_MINUTES = 2880;

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
    const requested = Math.ceil(parseDuration(timeout) / 60);
    expiresInMinutes = Math.min(requested, ECS_TASK_PROTECTION_MAX_MINUTES);
    if (requested > ECS_TASK_PROTECTION_MAX_MINUTES) {
      logger.warn("timeout exceeds ECS task protection maximum; clamping", { requested, clamped: ECS_TASK_PROTECTION_MAX_MINUTES });
    }
  }

  const url = `${agentUri}/task-protection/v1/state`;
  try {
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
  } catch (e) {
    logger.error("Failed to reach ECS task protection endpoint", { error: e instanceof Error ? e.message : String(e) });
  }
}

export async function disableTaskProtection(logger: Logger): Promise<void> {
  const agentUri = getAgentUri();
  if (!agentUri) return;

  const url = `${agentUri}/task-protection/v1/state`;
  try {
    const response = await fetch(url, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ProtectionEnabled: false }),
    });
    if (!response.ok) {
      const body = await response.text();
      logger.error("Failed to disable ECS task protection", { status: response.status, body });
    }
  } catch (e) {
    logger.error("Failed to reach ECS task protection endpoint", { error: e instanceof Error ? e.message : String(e) });
  }
}
