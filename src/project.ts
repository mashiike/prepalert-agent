import { readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import type { McpServerConfig } from "@anthropic-ai/claude-agent-sdk";
import { expandEnvVarsInObject, parseDuration } from "./config.js";

export interface CloudTasksDispatchOidc {
  serviceAccountEmail?: string | undefined;
  audience?: string | undefined;
}

export interface CloudTasksDispatchConfig {
  type: "cloud-tasks";
  queue: string;
  targetPath?: string | undefined;
  baseUrl?: string | undefined;
  dispatchDeadline?: string | undefined;
  oidc?: CloudTasksDispatchOidc | undefined;
}

export interface SqsDispatchConfig {
  type: "aws-sqs";
  queueUrl: string;
  targetPath?: string | undefined;
  baseUrl?: string | undefined;
}

export type DispatchConfig = CloudTasksDispatchConfig | SqsDispatchConfig;

export interface WebhookConfig {
  path: string;
  authType: "none" | "basic" | "oidc";
  headerPrompt?: string | undefined;
  sync?: boolean | undefined;
  ecsTaskProtection?: "auto" | "off" | undefined;
  username?: string | undefined;
  password?: string | undefined;
  issuer?: string | undefined;
  audience?: string | undefined;
  jwksUri?: string | undefined;
  dispatch?: DispatchConfig | undefined;
}

export interface HealthCheckStateConfig {
  status?: number | undefined;
  body?: string | { sh: string } | undefined;
}

export interface HealthCheckConfig {
  path?: string | undefined;
  contentType?: string | undefined;
  idle?: HealthCheckStateConfig | undefined;
  busy?: HealthCheckStateConfig | undefined;
}

export interface ServeAuthConfig {
  issuer: string;
  clientId: string;
  clientSecret: string;
  allowedDomains?: string[] | undefined;
}

export interface ServeConfig {
  port?: number | undefined;
  syncMode?: boolean | undefined;
  ecsTaskProtection?: "auto" | "off" | undefined;
  exportSecret?: string | undefined;
  sessionSecret?: string | undefined;
  baseUrl?: string | undefined;
  staticDir?: string | undefined;
  auth?: ServeAuthConfig | undefined;
  healthCheck?: HealthCheckConfig | undefined;
  webhooks?: WebhookConfig[] | undefined;
}

export type EffortLevel = "low" | "medium" | "high" | "xhigh" | "max";

export type PermissionMode = "default" | "acceptEdits" | "bypassPermissions" | "plan" | "dontAsk" | "auto";

export interface StorageOptions {
  endpoint?: string | undefined;
  forcePathStyle?: boolean | undefined;
  region?: string | undefined;
}

export interface ProjectConfig {
  name: string;
  model?: string | undefined;
  effort?: EffortLevel | undefined;
  allowedTools?: string[] | undefined;
  disallowedTools?: string[] | undefined;
  settingSources?: string[] | undefined;
  runbooksDir?: string | undefined;
  logsDir?: string | undefined;
  sessionsDir?: string | undefined;
  storage?: string | undefined;
  storageOptions?: StorageOptions | undefined;
  instructions?: string | undefined;
  instructionsFile?: string | undefined;
  maxTurns?: number | undefined;
  costLimit?: number | undefined;
  timeout?: string | undefined;
  mcpConfig?: string | undefined;
  serve?: ServeConfig | undefined;
}

export interface RunbookMeta {
  description: string;
  name?: string | undefined;
  trigger?: string | undefined;
  model?: string | undefined;
  effort?: EffortLevel | undefined;
  maxTurns?: number | undefined;
  costLimit?: number | undefined;
  allowedTools?: string[] | undefined;
  disallowedTools?: string[] | undefined;
}

export interface Runbook {
  id: string;
  meta: RunbookMeta;
  body: string;
}

export type { McpServerConfig };

export interface McpConfig {
  mcpServers: Record<string, McpServerConfig>;
}

export interface Project {
  dir: string;
  config: ProjectConfig;
  mcpConfig: McpConfig;
  runbooks: Runbook[];
}

function parseFrontmatter(content: string): { meta: Record<string, unknown>; body: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) {
    return { meta: {}, body: content };
  }
  try {
    const parsed: unknown = parseYaml(match[1]!);
    if (parsed === null || typeof parsed !== "object") {
      return { meta: {}, body: match[2]!.trimStart() };
    }
    return { meta: parsed as Record<string, unknown>, body: match[2]!.trimStart() };
  } catch {
    return { meta: {}, body: match[2]!.trimStart() };
  }
}

const CONFIG_FILENAMES = ["prepalert.yaml", "prepalert.yml"];

async function findConfigPath(projectDir: string): Promise<string | null> {
  for (const name of CONFIG_FILENAMES) {
    const path = join(projectDir, name);
    try {
      await readFile(path, "utf-8");
      return path;
    } catch (e) {
      if (e instanceof Error && "code" in e && (e as NodeJS.ErrnoException).code === "ENOENT") {
        continue;
      }
      throw new Error(`Cannot read ${path}: ${e instanceof Error ? e.message : String(e)}`, { cause: e });
    }
  }
  return null;
}

async function loadProjectConfig(projectDir: string): Promise<ProjectConfig> {
  const configPath = await findConfigPath(projectDir);
  if (!configPath) {
    throw new Error(`prepalert.yaml (or prepalert.yml) not found in ${projectDir}`);
  }
  try {
    const raw = await readFile(configPath, "utf-8");
    const parsed: unknown = parseYaml(raw);
    if (parsed === null || typeof parsed !== "object") {
      throw new Error(`Invalid config file: ${configPath}`);
    }
    const config = parsed as Record<string, unknown>;
    if (typeof config["name"] !== "string" || config["name"].length === 0) {
      throw new Error(`"name" is required in ${configPath}`);
    }
    if (config["instructions"] !== undefined && config["instructionsFile"] !== undefined) {
      throw new Error(`"instructions" and "instructionsFile" cannot both be set in ${configPath}`);
    }
    const expanded = expandEnvVarsInObject(parsed) as ProjectConfig;
    if (expanded.timeout !== undefined) {
      try {
        parseDuration(expanded.timeout);
      } catch {
        throw new Error(`Invalid "timeout" in ${configPath}: expected a duration like "30m" or "1h", got ${JSON.stringify(expanded.timeout)}`);
      }
    }
    if (expanded.instructionsFile) {
      const filePath = join(projectDir, expanded.instructionsFile);
      expanded.instructions = await readFile(filePath, "utf-8");
      expanded.instructionsFile = undefined;
    }
    return expanded;
  } catch (e) {
    if (e instanceof Error && (e.message.includes("is required") || e.message.includes("cannot both be set") || e.message.includes("Invalid"))) {
      throw e;
    }
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`Failed to load ${configPath}: ${msg}`, { cause: e });
  }
}

async function loadMcpConfig(projectDir: string, mcpConfigPath: string): Promise<McpConfig> {
  const configPath = join(projectDir, mcpConfigPath);
  let raw: string;
  try {
    raw = await readFile(configPath, "utf-8");
  } catch (e) {
    if (e instanceof Error && "code" in e && (e as NodeJS.ErrnoException).code === "ENOENT") {
      return { mcpServers: {} };
    }
    throw new Error(`Cannot read ${configPath}: ${e instanceof Error ? e.message : String(e)}`, { cause: e });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    if (e instanceof SyntaxError) {
      throw new Error(`Invalid JSON in ${configPath}: ${e.message}`, { cause: e });
    }
    throw e;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Invalid MCP config: ${configPath} is not a JSON object`);
  }
  const mcpServers = (parsed as Record<string, unknown>)["mcpServers"];
  if (mcpServers === null || typeof mcpServers !== "object" || Array.isArray(mcpServers)) {
    throw new Error(`Invalid MCP config: "mcpServers" in ${configPath} must be an object`);
  }
  return { mcpServers: mcpServers as Record<string, McpServerConfig> };
}

function toStringArray(value: unknown): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === "string");
  }
  if (typeof value === "string") {
    return value.split(/\s+/).filter((s) => s.length > 0);
  }
  return undefined;
}

async function loadRunbooks(projectDir: string, runbooksDir: string): Promise<Runbook[]> {
  const absoluteRunbooksDir = join(projectDir, runbooksDir);
  let entries: string[];
  try {
    entries = await readdir(absoluteRunbooksDir, { recursive: true }) as string[];
  } catch {
    return [];
  }

  const mdFiles = entries.filter((e) => e.endsWith(".md"));
  const runbooks: Runbook[] = [];

  for (const mdFile of mdFiles) {
    const fullPath = join(absoluteRunbooksDir, mdFile);
    let content: string;
    try {
      content = await readFile(fullPath, "utf-8");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(`Failed to read runbook ${fullPath}: ${msg}`, { cause: e });
    }
    const { meta, body } = parseFrontmatter(content);
    const id = mdFile.replace(/\.md$/, "");
    runbooks.push({
      id,
      meta: {
        description: typeof meta["description"] === "string" ? meta["description"] : "",
        ...(typeof meta["name"] === "string" ? { name: meta["name"] } : {}),
        ...(typeof meta["trigger"] === "string" ? { trigger: meta["trigger"] } : {}),
        ...(typeof meta["model"] === "string" ? { model: meta["model"] } : {}),
        ...(typeof meta["effort"] === "string" ? { effort: meta["effort"] as EffortLevel } : {}),
        ...(typeof meta["maxTurns"] === "number" ? { maxTurns: meta["maxTurns"] } : {}),
        ...(typeof meta["costLimit"] === "number" ? { costLimit: meta["costLimit"] } : {}),
        ...(toStringArray(meta["allowedTools"]) ? { allowedTools: toStringArray(meta["allowedTools"]) } : {}),
        ...(toStringArray(meta["disallowedTools"]) ? { disallowedTools: toStringArray(meta["disallowedTools"]) } : {}),
      },
      body,
    });
  }
  return runbooks;
}

export async function loadProject(projectDir: string): Promise<Project> {
  const dir = resolve(projectDir);
  const config = await loadProjectConfig(dir);
  const runbooksDir = config.runbooksDir ?? "runbooks";
  const mcpConfigPath = config.mcpConfig ?? ".mcp.json";

  const [mcpConfig, runbooks] = await Promise.all([
    loadMcpConfig(dir, mcpConfigPath),
    loadRunbooks(dir, runbooksDir),
  ]);

  return { dir, config, mcpConfig, runbooks };
}
