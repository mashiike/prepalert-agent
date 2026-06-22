import type { Options, McpServerConfig, CanUseTool, SettingSource } from "@anthropic-ai/claude-agent-sdk";
import type { Project, PermissionMode } from "../project.js";
import type { SessionWriter } from "../session-writer.js";
import { buildSessionToolsServer } from "../session-tools.js";
import { buildDocsToolsServer } from "../docs-tools.js";
import { buildRunbookAgents, RUNBOOK_AGENT_PREFIX } from "./agents.js";

export interface SessionContext {
  sessionId: string;
  baseUrl?: string | undefined;
}

export function buildSystemPrompt(project: Project, session?: SessionContext | undefined): string {
  const parts: string[] = [];

  parts.push("You are prepalert-agent, an SRE agent CLI tool. You investigate alerts and operational issues by delegating to the appropriate runbook agent(s).");

  const envLines = [`- Project directory: ${project.dir}`];
  const maxTurns = project.config.maxTurns ?? 10;
  envLines.push(`- Max turns: ${maxTurns} (the session will stop after this many agent turns — plan your investigation to complete within this limit)`);
  if (project.config.costLimit) {
    envLines.push(`- Cost limit: $${project.config.costLimit} USD (the session will stop if cumulative API cost exceeds this amount)`);
  }
  if (project.config.timeout) {
    envLines.push(`- Timeout: ${project.config.timeout}`);
  }
  if (session) {
    if (session.baseUrl) {
      envLines.push(`- Session URL: ${session.baseUrl}/sessions/${session.sessionId}`);
    } else {
      envLines.push(`- Session ID: ${session.sessionId}`);
    }
  }
  parts.push(`## Environment\n${envLines.join("\n")}`);

  parts.push(`## Resource Awareness
When you receive tool results, the system appends a status line showing your current resource usage:
- **Turn N/M**: current turn number out of the maximum allowed
- **Cost $X.XXXX / $Y.YYYY**: cumulative cost so far and the cost limit (if configured)

Use this information to pace your investigation. If you are approaching the turn or cost limit, prioritize summarizing your findings over starting new investigations.`);

  if (project.config.instructions) {
    parts.push(`## Project Instructions\n${project.config.instructions}`);
  }

  parts.push(`## How to Respond
1. Analyze the user's request
2. Determine which runbook agent(s) are relevant — runbook agents are prefixed with \`${RUNBOOK_AGENT_PREFIX}\`
3. Delegate to the relevant runbook agent(s) using the Agent tool, passing the context
4. If multiple runbooks are relevant, delegate them in order of relevance
5. Collect the reports from each runbook agent
6. Summarize the overall findings from all runbook reports`);

  return parts.join("\n\n");
}

const DEFAULT_READONLY_TOOLS = ["Read", "Glob", "Grep", "WebSearch", "WebFetch", "Agent"];

function buildDefaultAllowedTools(project: Project): string[] {
  const mcpGlobs = Object.keys(project.mcpConfig.mcpServers).map(
    (name) => `mcp__${name}__*`,
  );
  return [...DEFAULT_READONLY_TOOLS, ...mcpGlobs];
}

interface HeadlessOptions {
  mode: "headless";
  abortController?: AbortController | undefined;
  sessionWriter?: SessionWriter | undefined;
  session?: SessionContext | undefined;
}

interface InteractiveOptions {
  mode: "interactive";
  permissionMode: PermissionMode;
  canUseTool?: CanUseTool | undefined;
  sessionWriter?: SessionWriter | undefined;
  session?: SessionContext | undefined;
}

export type BuildOptions = HeadlessOptions | InteractiveOptions;

export function buildQueryOptions(project: Project, opts: BuildOptions): Options {
  const systemPrompt = buildSystemPrompt(project, opts.session);
  const agents = buildRunbookAgents(project);
  const mcpServers: Record<string, McpServerConfig> = {
    ...(project.mcpConfig.mcpServers as Record<string, McpServerConfig>),
  };

  if (opts.sessionWriter) {
    mcpServers["session-tools"] = buildSessionToolsServer(opts.sessionWriter);
  }

  const disallowedTools = project.config.disallowedTools;

  function buildCommon(): Options {
    const result: Options = {
      systemPrompt,
      mcpServers,
      agents,
      cwd: project.dir,
      settingSources: (project.config.settingSources ?? ["project", "local"]) as SettingSource[],
      maxTurns: project.config.maxTurns ?? 10,
      permissionMode: "default",
    };
    if (disallowedTools) result.disallowedTools = disallowedTools;
    if (project.config.model) result.model = project.config.model;
    if (project.config.costLimit) result.maxBudgetUsd = project.config.costLimit;
    return result;
  }

  const result = buildCommon();

  if (opts.mode === "headless") {
    result.permissionMode = "dontAsk";
    const allowed = [...(project.config.allowedTools ?? buildDefaultAllowedTools(project))];
    if (opts.sessionWriter) {
      allowed.push("mcp__session-tools__*");
    }
    result.allowedTools = allowed;
    if (opts.abortController) result.abortController = opts.abortController;
    return result;
  }

  mcpServers["docs-tools"] = buildDocsToolsServer();
  result.permissionMode = opts.permissionMode;
  if (opts.canUseTool) result.canUseTool = opts.canUseTool;
  if (project.config.allowedTools) result.allowedTools = project.config.allowedTools;
  return result;
}
