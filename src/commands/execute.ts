import { createInterface, type Interface as ReadlineInterface } from "node:readline";
import { query, type Query, type McpServerStatus, type SDKUserMessage, type SDKMessage, type CanUseTool } from "@anthropic-ai/claude-agent-sdk";
import type { Project, PermissionMode } from "../project.js";
import { parseDuration } from "../config.js";
import { NullLogger, type Logger } from "../logger.js";
import { type TranscriptWriter, LocalTranscriptWriter, sdkMessageToEvent } from "../transcript.js";
import { isOTelEnabled, SessionTelemetry, type TokenUsage } from "../telemetry.js";
import { SessionWriter } from "../session-writer.js";
import { RUNBOOK_AGENT_PREFIX } from "./agents.js";
import { buildQueryOptions, type SessionContext } from "./prompt.js";

export { RUNBOOK_AGENT_PREFIX } from "./agents.js";
export { buildSystemPrompt } from "./prompt.js";
export type { SessionContext } from "./prompt.js";

/**
 * Watches SDK messages for runbook agent invocations and saves each agent's
 * final result as a runbook report via SessionWriter.writeRunbookReport.
 * Does nothing when the writer does not support runbook reports.
 */
export class RunbookReportTracker {
  private pendingAgentCalls = new Map<string, { runbookId: string; toolUseId: string }>();
  private readonly writer: SessionWriter | null;
  private readonly logger: Logger;
  private readonly pendingWrites: Promise<void>[] = [];

  constructor(writer: TranscriptWriter, logger: Logger) {
    this.writer = "writeRunbookReport" in writer ? writer as SessionWriter : null;
    this.logger = logger;
  }

  handleMessage(message: SDKMessage): void {
    if (message.type === "assistant") {
      for (const block of message.message.content) {
        if (block.type === "tool_use" && block.name === "Agent") {
          const input = block.input as Record<string, unknown>;
          const agentName = (input["subagent_type"] ?? "") as string;
          if (agentName.startsWith(RUNBOOK_AGENT_PREFIX)) {
            const runbookId = agentName.slice(RUNBOOK_AGENT_PREFIX.length);
            this.pendingAgentCalls.set(block.id, { runbookId, toolUseId: block.id });
          }
        }
      }
    } else if (message.type === "user") {
      for (const { toolUseId, text } of extractToolResults(message)) {
        const pending = this.pendingAgentCalls.get(toolUseId);
        if (!pending) continue;
        this.pendingAgentCalls.delete(toolUseId);
        if (text && this.writer) {
          const p = this.writer.writeRunbookReport(pending.runbookId, pending.toolUseId, text).catch(e => {
            const msg = e instanceof Error ? e.message : String(e);
            this.logger.warn("failed to save runbook report", { runbookId: pending.runbookId, toolUseId: pending.toolUseId, error: msg });
          });
          this.pendingWrites.push(p);
        }
      }
    }
  }

  async flush(): Promise<void> {
    await Promise.allSettled(this.pendingWrites);
    this.pendingWrites.length = 0;
  }
}

export interface ToolResultEntry {
  toolUseId: string;
  /** null when the tool_result has no text content (e.g. image-only). */
  text: string | null;
}

/**
 * Extracts every tool_result block in a user message, pairing each one's
 * tool_use_id with its own text content.
 */
export function extractToolResults(message: SDKUserMessage): ToolResultEntry[] {
  const content = message.message.content;
  if (!Array.isArray(content)) return [];

  const entries: ToolResultEntry[] = [];
  for (const block of content) {
    if (typeof block !== "object" || block === null || !("type" in block)) continue;
    if (block.type !== "tool_result" || !("tool_use_id" in block)) continue;

    const inner = "content" in block ? block.content : undefined;
    let text: string | null = null;
    if (typeof inner === "string") {
      text = inner;
    } else if (Array.isArray(inner)) {
      const texts: string[] = [];
      for (const item of inner) {
        if (typeof item === "object" && item !== null && "type" in item && item.type === "text" && "text" in item) {
          texts.push(item.text as string);
        }
      }
      text = texts.length > 0 ? texts.join("") : null;
    }

    entries.push({ toolUseId: block.tool_use_id as string, text });
  }
  return entries;
}

function recordTranscript(writer: TranscriptWriter, message: SDKMessage): void {
  const event = sdkMessageToEvent(message);
  if (event) {
    writer.write(event);
  }
}

function logSdkDiagnostics(logger: Logger, message: SDKMessage): void {
  if (message.type === "system" && "subtype" in message && message.subtype === "thinking_tokens") {
    const m = message as { estimated_tokens: number; estimated_tokens_delta: number };
    logger.debug("thinking tokens", { estimated_tokens: m.estimated_tokens, estimated_tokens_delta: m.estimated_tokens_delta });
  }
  if (message.type === "rate_limit_event") {
    const m = message as { rate_limit_info: Record<string, unknown> };
    logger.info("rate limit event", m.rate_limit_info);
  }
}

function handleTelemetryMessage(telemetry: SessionTelemetry | null, message: SDKMessage): void {
  if (!telemetry) return;

  if (message.type === "assistant") {
    const toolUseBlocks: Array<{ id: string; name: string }> = [];
    for (const block of message.message.content) {
      if (block.type === "tool_use") {
        toolUseBlocks.push({ id: block.id, name: block.name });
      }
    }
    if (toolUseBlocks.length > 0) {
      telemetry.startTools(toolUseBlocks);
    }
  } else if (message.type === "tool_use_summary") {
    telemetry.endTools(message.preceding_tool_use_ids);
  } else if (message.type === "result") {
    telemetry.recordResult(
      message.total_cost_usd,
      message.num_turns,
      message.is_error,
      message.usage as TokenUsage | undefined,
    );
  }
}

class ProgressIndicator {
  private currentLine = "";
  private isTTY: boolean;

  constructor() {
    this.isTTY = process.stderr.isTTY ?? false;
  }

  update(text: string): void {
    if (this.isTTY) {
      process.stderr.write(`\r\x1b[K${text}`);
    }
    this.currentLine = text;
  }

  clear(): void {
    if (this.isTTY && this.currentLine) {
      process.stderr.write("\r\x1b[K");
    }
    this.currentLine = "";
  }

  handleMessage(message: SDKMessage): void {
    if (message.type === "system" && "subtype" in message) {
      if (message.subtype === "status") {
        const status = (message as { status: string | null }).status;
        if (status === "requesting") {
          this.update("⏳ Thinking...");
        } else if (status === null) {
          this.clear();
        }
        return;
      }
      if (message.subtype === "thinking_tokens") {
        const tokens = (message as { estimated_tokens: number }).estimated_tokens;
        this.update(`⏳ Thinking... (${tokens} tokens)`);
        return;
      }
    }
    if (message.type === "tool_progress") {
      const m = message as { tool_name: string; elapsed_time_seconds: number };
      this.update(`🔧 ${m.tool_name} (${Math.round(m.elapsed_time_seconds)}s)`);
      return;
    }
    if (message.type === "tool_use_summary") {
      this.clear();
      return;
    }
    if (message.type === "assistant") {
      this.clear();
    }
  }
}

export interface ExecuteOptions {
  logger: Logger;
  transcriptWriter: TranscriptWriter;
  baseUrl?: string | undefined;
}

export interface ExecutePromptResult {
  responseText: string;
  totalCostUsd: number;
  numTurns: number;
  isError: boolean;
}

export async function executePrompt(project: Project, prompt: string, opts: ExecuteOptions): Promise<ExecutePromptResult> {
  const { logger, transcriptWriter } = opts;
  const abortController = new AbortController();
  let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
  if (project.config.timeout) {
    const timeoutSec = parseDuration(project.config.timeout);
    timeoutTimer = setTimeout(() => abortController.abort(), timeoutSec * 1000);
  }

  const sessionWriter = transcriptWriter instanceof SessionWriter ? transcriptWriter : undefined;
  const session: SessionContext | undefined = sessionWriter
    ? { sessionId: sessionWriter.sessionId, baseUrl: opts.baseUrl }
    : undefined;
  const options = buildQueryOptions(project, { mode: "headless", abortController, sessionWriter, session });

  const sessionTelemetry = isOTelEnabled() ? new SessionTelemetry(transcriptWriter instanceof LocalTranscriptWriter ? transcriptWriter.sessionId : crypto.randomUUID()) : null;
  sessionTelemetry?.startTurn();
  let lastCostUsd = 0;
  let lastIsError = false;
  let lastNumTurns = 0;
  const responseChunks: string[] = [];
  logger.info("executePrompt started", {
    promptLength: prompt.length,
    model: options.model,
    maxTurns: options.maxTurns,
    mcpServers: Object.keys(options.mcpServers ?? {}),
  });
  transcriptWriter.write({
    timestamp: new Date().toISOString(),
    type: "user",
    content: prompt,
    parent_tool_use_id: null,
  });
  const runbookTracker = new RunbookReportTracker(transcriptWriter, logger);
  logger.debug("waiting for first SDK message");
  try {
    for await (const message of query({ prompt, options })) {
      logger.debug("message received", { type: message.type, subtype: "subtype" in message ? message.subtype : undefined });
      recordTranscript(transcriptWriter, message);
      logSdkDiagnostics(logger, message);
      handleTelemetryMessage(sessionTelemetry, message);
      runbookTracker.handleMessage(message);
      if (message.type === "assistant") {
        for (const block of message.message.content) {
          if (block.type === "text") {
            responseChunks.push(block.text);
          }
        }
      } else if (message.type === "result") {
        lastCostUsd = message.total_cost_usd;
        lastIsError = message.is_error;
        lastNumTurns = message.num_turns;
        const maxTurns = options.maxTurns ?? 10;
        logger.info("executePrompt completed", {
          cost_usd: message.total_cost_usd,
          cost_limit_usd: project.config.costLimit ?? null,
          num_turns: message.num_turns,
          max_turns: maxTurns,
          is_error: message.is_error,
        });
      }
    }
  } finally {
    if (timeoutTimer !== undefined) clearTimeout(timeoutTimer);
    await runbookTracker.flush();
    sessionTelemetry?.end(lastCostUsd, lastIsError);
    await transcriptWriter.close();
  }
  return {
    responseText: responseChunks.join(""),
    totalCostUsd: lastCostUsd,
    numTurns: lastNumTurns,
    isError: lastIsError,
  };
}

function displayMcpStatus(statuses: McpServerStatus[], logger: Logger): void {
  if (statuses.length === 0) {
    console.log("No MCP servers configured.");
    return;
  }
  for (const s of statuses) {
    const toolCount = s.tools ? ` (${s.tools.length} tools)` : "";
    console.log(`  ${s.status.padEnd(12)} ${s.name}${toolCount}`);
    if (s.error) {
      console.log(`               error: ${s.error}`);
      logger.warn("MCP server error", { name: s.name, error: s.error });
    }
    if (s.status === "connected" && s.tools) {
      for (const t of s.tools) {
        console.log(`               - ${t.name}`);
      }
    }
  }
}

function displayMcpConfigured(project: Project): void {
  const names = Object.keys(project.mcpConfig.mcpServers);
  if (names.length === 0) {
    console.log("No MCP servers configured.");
    return;
  }
  for (const name of names) {
    console.log(`  ${"configured".padEnd(12)} ${name}`);
  }
}

async function testMcpConnections(q: Query, serverNames: string[], logger: Logger): Promise<McpServerStatus[]> {
  const targetSet = new Set(serverNames);
  const before = await q.mcpServerStatus();
  const targets = before.filter((s) => targetSet.has(s.name));
  const needsReconnect = targets.filter((s) => s.status === "pending" || s.status === "failed");
  for (const s of needsReconnect) {
    console.log(`  connecting ${s.name}...`);
    logger.debug("MCP server connecting", { name: s.name });
    try {
      await q.reconnectMcpServer(s.name);
    } catch (e) {
      logger.debug("MCP server reconnect failed", { name: s.name, error: e instanceof Error ? e.message : String(e) });
    }
  }
  const already = targets.filter((s) => s.status === "connected");
  for (const s of already) {
    console.log(`  ${s.name} already connected`);
  }
  const after = await q.mcpServerStatus();
  return after.filter((s) => targetSet.has(s.name));
}

interface CommandContext {
  getQuery: () => Query;
  mcpStatuses: McpServerStatus[] | null;
  project: Project;
  logger: Logger;
  costOffset: number;
  turnsOffset: number;
  lastTotalCostUsd: number;
  lastNumTurns: number;
}

async function handleBuiltinCommand(line: string, ctx: CommandContext): Promise<"continue" | "exit" | false> {
  if (line === "exit" || line === "/exit") {
    return "exit";
  }
  if (line === "/help") {
    console.log("Available commands:");
    console.log("  /mcp          Show MCP server status");
    console.log("  /mcp test     Test MCP server connections");
    console.log("  /status       Show session and account info");
    console.log("  /reset        Reset cost and turn counters");
    console.log("  /help         Show this help");
    console.log("  exit          Exit the session");
    return "continue";
  }
  if (line === "/mcp") {
    if (ctx.mcpStatuses !== null) {
      const projectNames = new Set(Object.keys(ctx.project.mcpConfig.mcpServers));
      displayMcpStatus(ctx.mcpStatuses.filter((s) => projectNames.has(s.name)), ctx.logger);
    } else {
      displayMcpConfigured(ctx.project);
    }
    return "continue";
  }
  if (line === "/mcp test") {
    console.log("Testing MCP server connections...");
    try {
      const q = ctx.getQuery();
      const projectServerNames = Object.keys(ctx.project.mcpConfig.mcpServers);
      const statuses = await testMcpConnections(q, projectServerNames, ctx.logger);
      ctx.mcpStatuses = statuses;
      displayMcpStatus(statuses, ctx.logger);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.log(`  error: ${msg}`);
    }
    return "continue";
  }
  if (line === "/status") {
    console.log(`Project: ${ctx.project.config.name}`);
    console.log(`Model: ${ctx.project.config.model ?? "(default)"}`);
    console.log(`Effort: ${ctx.project.config.effort ?? "(default)"}`);
    console.log(`Runbooks: ${ctx.project.runbooks.length}`);
    try {
      const q = ctx.getQuery();
      const info = await q.accountInfo();
      if (info.email) console.log(`Account: ${info.email}`);
      if (info.organization) console.log(`Organization: ${info.organization}`);
      if (info.apiProvider) console.log(`Provider: ${info.apiProvider}`);
      if (info.subscriptionType) console.log(`Subscription: ${info.subscriptionType}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.log(`Account: error - ${msg}`);
    }
    return "continue";
  }
  if (line === "/reset") {
    ctx.costOffset = ctx.lastTotalCostUsd;
    ctx.turnsOffset = ctx.lastNumTurns;
    console.log("Cost and turn counters have been reset.");
    return "continue";
  }
  return false;
}

function buildCanUseTool(rl: ReadlineInterface): CanUseTool {
  const ask = (question: string): Promise<string> =>
    new Promise((resolve) => {
      rl.question(question, (answer) => resolve(answer));
    });

  return async (toolName, input, context) => {
    const title = context.title ?? `${toolName}`;
    const description = context.description ?? "";
    console.log(`\n[permission] ${title}`);
    if (description) {
      console.log(`  ${description}`);
    }
    if (toolName === "Bash" && typeof input["command"] === "string") {
      console.log(`  $ ${input["command"]}`);
    }
    const answer = await ask("  Allow? (y)es / (n)o / (a)lways: ");
    const choice = answer.trim().toLowerCase();
    if (choice === "a" || choice === "always") {
      const persist = (context.suggestions ?? []).filter(
        (s) => "destination" in s && s.destination === "localSettings",
      );
      return { behavior: "allow", updatedPermissions: persist };
    }
    if (choice === "y" || choice === "yes") {
      return { behavior: "allow" };
    }
    return { behavior: "deny", message: "User denied this action" };
  };
}

export async function executeInteractive(project: Project, permissionMode: PermissionMode = "default", opts?: ExecuteOptions): Promise<void> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const sessionWriter = opts?.transcriptWriter instanceof SessionWriter ? opts.transcriptWriter : undefined;
  const session: SessionContext | undefined = sessionWriter
    ? { sessionId: sessionWriter.sessionId }
    : undefined;
  const interactiveOpts = { mode: "interactive" as const, permissionMode, sessionWriter, session, canUseTool: undefined as CanUseTool | undefined };
  if (permissionMode !== "dontAsk") {
    interactiveOpts.canUseTool = buildCanUseTool(rl);
  }
  const options = buildQueryOptions(project, interactiveOpts);

  const askLine = (): Promise<string | null> =>
    new Promise((resolve) => {
      rl.question("> ", (answer) => resolve(answer));
      rl.once("close", () => resolve(null));
    });

  let q: Query | null = null;
  let resolveInput: ((line: string | null) => void) | undefined;

  async function* userMessageStream(): AsyncGenerator<SDKUserMessage> {
    while (true) {
      const line: string | null = await new Promise((resolve) => {
        resolveInput = resolve;
      });
      resolveInput = undefined;
      if (line === null) return;

      logger.debug("yielding user message to SDK", { length: line.length });
      yield {
        type: "user",
        message: { role: "user", content: line },
        parent_tool_use_id: null,
      };
      logger.debug("user message yielded, SDK processing");
    }
  }

  const logger = opts?.logger ?? new NullLogger();
  const transcriptWriter = opts?.transcriptWriter;
  const sessionId = transcriptWriter instanceof LocalTranscriptWriter ? transcriptWriter.sessionId : crypto.randomUUID();
  const sessionTelemetry = isOTelEnabled() ? new SessionTelemetry(sessionId) : null;

  logger.info("interactive session started", { project: project.config.name, permissionMode });

  const ctx: CommandContext = {
    getQuery: () => {
      if (q === null) {
        q = query({ prompt: userMessageStream(), options });
      }
      return q;
    },
    mcpStatuses: null,
    project,
    logger,
    costOffset: 0,
    turnsOffset: 0,
    lastTotalCostUsd: 0,
    lastNumTurns: 0,
  };

  const waitForInput = async (): Promise<boolean> => {
    while (true) {
      const line = await askLine();
      if (line === null) {
        logger.info("interactive session ended", { reason: "eof" });
        resolveInput?.(null);
        return false;
      }
      if (line.trim() === "") continue;

      const trimmed = line.trim();
      const cmd = await handleBuiltinCommand(trimmed, ctx);
      if (cmd === "exit") {
        logger.info("interactive session ended", { reason: "exit" });
        resolveInput?.(null);
        return false;
      }
      if (cmd === "continue") continue;

      logger.debug("user input received", { length: trimmed.length });
      resolveInput?.(line);
      return true;
    }
  };

  const progress = new ProgressIndicator();
  try {
    logger.debug("creating query", {
      model: options.model,
      permissionMode: options.permissionMode,
      maxTurns: options.maxTurns,
      mcpServers: Object.keys(options.mcpServers ?? {}),
      agents: Object.keys(options.agents ?? {}),
    });
    ctx.getQuery();
    logger.debug("query created, waiting for initial input");
    if (!await waitForInput()) return;
    logger.debug("first input received, entering message loop");

    sessionTelemetry?.startTurn();

    for await (const message of q!) {
      logger.debug("message received", { type: message.type, subtype: "subtype" in message ? message.subtype : undefined });
      if (transcriptWriter) {
        recordTranscript(transcriptWriter, message);
      }
      logSdkDiagnostics(logger, message);
      progress.handleMessage(message);
      handleTelemetryMessage(sessionTelemetry, message);
      if (message.type === "system" && message.subtype === "init" && "mcp_servers" in message) {
        const servers = (message as { mcp_servers: McpServerStatus[] }).mcp_servers;
        ctx.mcpStatuses = servers;
        logger.info("agent initialized", {
          mcp_servers: servers.map(s => ({ name: s.name, status: s.status })),
        });
      } else if (message.type === "assistant") {
        for (const block of message.message.content) {
          if (block.type === "text") {
            process.stdout.write(block.text);
          }
        }
      } else if (message.type === "result") {
        progress.clear();
        ctx.lastTotalCostUsd = message.total_cost_usd;
        ctx.lastNumTurns = message.num_turns;
        const cost = message.total_cost_usd - ctx.costOffset;
        const turns = message.num_turns - ctx.turnsOffset;
        logger.info("turn completed", {
          cost_usd: cost,
          total_cost_usd: message.total_cost_usd,
          turns,
          total_turns: message.num_turns,
          is_error: message.is_error,
        });
        const maxTurns = options.maxTurns ?? 10;
        const costLimitStr = project.config.costLimit ? ` / $${project.config.costLimit}` : "";
        process.stdout.write("\n---\n");
        process.stdout.write(`Turn ${turns}/${maxTurns} | Cost: $${cost.toFixed(4)}${costLimitStr}\n`);

        sessionTelemetry?.startTurn();
        if (!await waitForInput()) return;
      }
    }
  } finally {
    progress.clear();
    sessionTelemetry?.end(ctx.lastTotalCostUsd, false);
    if (transcriptWriter) {
      await transcriptWriter.close();
    }
    rl.close();
  }
}
