import { existsSync } from "node:fs";
import { basename, dirname, join } from "node:path";

const DEV_RUNTIME_NAMES = new Set(["bun", "node"]);

/**
 * Resolves the path to the native `claude` CLI executable that the Agent SDK
 * spawns as a subprocess. Falls back to a `claude` binary shipped alongside
 * this executable, since compiled release binaries have no node_modules for
 * the SDK to resolve it from. Skips the sibling lookup when running under a
 * `bun`/`node` runtime (dev mode) — `process.execPath` there points at the
 * runtime binary, not this project's executable, so its directory is not a
 * meaningful place to look for a sibling `claude`.
 */
export function resolveClaudeExecutablePath(
  cliValue: string | undefined,
  env: Record<string, string | undefined> = process.env,
  execPath: string = process.execPath,
): string | undefined {
  if (cliValue) return cliValue;
  const envValue = env["PREPALERT_CLAUDE_EXECUTABLE_PATH"];
  if (envValue) return envValue;
  if (DEV_RUNTIME_NAMES.has(basename(execPath).toLowerCase())) return undefined;
  const siblingPath = join(dirname(execPath), "claude");
  return existsSync(siblingPath) ? siblingPath : undefined;
}
