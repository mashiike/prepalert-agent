import { mkdirSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { Logger } from "./logger.js";
import { createSessionDir } from "./storage.js";

export interface TranscriptEvent {
  timestamp: string;
  type: string;
  [key: string]: unknown;
}

export interface TranscriptWriter {
  write(event: TranscriptEvent): void;
  close(): Promise<void>;
}

export function sdkMessageToEvent(message: SDKMessage): TranscriptEvent | null {
  const timestamp = new Date().toISOString();

  switch (message.type) {
    case "user": {
      return {
        timestamp,
        type: "user",
        content: message.message.content,
        parent_tool_use_id: message.parent_tool_use_id,
      };
    }
    case "assistant": {
      const textBlocks: string[] = [];
      const toolUseBlocks: { id: string; name: string; input: unknown }[] = [];
      for (const block of message.message.content) {
        if (block.type === "text") {
          textBlocks.push(block.text);
        } else if (block.type === "tool_use") {
          toolUseBlocks.push({ id: block.id, name: block.name, input: block.input });
        }
      }
      const event: TranscriptEvent = {
        timestamp,
        type: "assistant",
        content: textBlocks.join(""),
        parent_tool_use_id: message.parent_tool_use_id,
      };
      if (toolUseBlocks.length > 0) {
        event["tool_use"] = toolUseBlocks;
      }
      if (message.error) {
        event["error"] = message.error;
      }
      const m = message as { subagent_type?: string; task_description?: string };
      if (m.subagent_type) event["subagent_type"] = m.subagent_type;
      if (m.task_description) event["task_description"] = m.task_description;
      return event;
    }
    case "result": {
      return {
        timestamp,
        type: "result",
        subtype: message.subtype,
        is_error: message.is_error,
        num_turns: message.num_turns,
        total_cost_usd: message.total_cost_usd,
        duration_ms: message.duration_ms,
        usage: message.usage,
      };
    }
    case "tool_use_summary": {
      return {
        timestamp,
        type: "tool_use_summary",
        summary: message.summary,
        preceding_tool_use_ids: message.preceding_tool_use_ids,
      };
    }
    case "tool_progress":
      return null;
    case "system": {
      if (message.subtype === "init") {
        return {
          timestamp,
          type: "system",
          subtype: "init",
          model: (message as { model?: string }).model,
          mcp_servers: (message as { mcp_servers?: unknown }).mcp_servers,
          tools: (message as { tools?: unknown }).tools,
        };
      }
      if (message.subtype === "thinking_tokens") {
        return null;
      }
      if (message.subtype === "hook_started") {
        const m = message as { hook_name: string; hook_event: string };
        return {
          timestamp,
          type: "system",
          subtype: "hook_started",
          hook_name: m.hook_name,
          hook_event: m.hook_event,
        };
      }
      if (message.subtype === "hook_response") {
        const m = message as { hook_name: string; hook_event: string; output: string; exit_code?: number; outcome: string };
        return {
          timestamp,
          type: "system",
          subtype: "hook_response",
          hook_name: m.hook_name,
          hook_event: m.hook_event,
          output: m.output,
          exit_code: m.exit_code,
          outcome: m.outcome,
        };
      }
      if (message.subtype === "hook_progress") {
        const m = message as { hook_name: string; hook_event: string; output: string };
        return {
          timestamp,
          type: "system",
          subtype: "hook_progress",
          hook_name: m.hook_name,
          hook_event: m.hook_event,
          output: m.output,
        };
      }
      if (message.subtype === "api_retry") {
        const m = message as { attempt: number; max_retries: number; retry_delay_ms: number; error_status: number | null };
        return {
          timestamp,
          type: "system",
          subtype: "api_retry",
          attempt: m.attempt,
          max_retries: m.max_retries,
          retry_delay_ms: m.retry_delay_ms,
          error_status: m.error_status,
        };
      }
      if (message.subtype === "task_started") {
        const m = message as { task_id: string; tool_use_id?: string; description: string; subagent_type?: string; task_type?: string };
        return {
          timestamp,
          type: "system",
          subtype: "task_started",
          task_id: m.task_id,
          tool_use_id: m.tool_use_id,
          description: m.description,
          subagent_type: m.subagent_type,
          task_type: m.task_type,
        };
      }
      if (message.subtype === "task_notification") {
        const m = message as { task_id: string; tool_use_id?: string; status: string; summary: string; usage?: unknown };
        return {
          timestamp,
          type: "system",
          subtype: "task_notification",
          task_id: m.task_id,
          tool_use_id: m.tool_use_id,
          status: m.status,
          summary: m.summary,
          usage: m.usage,
        };
      }
      if (message.subtype === "task_progress") {
        const m = message as { task_id: string; tool_use_id?: string; description: string; usage?: unknown };
        return {
          timestamp,
          type: "system",
          subtype: "task_progress",
          task_id: m.task_id,
          tool_use_id: m.tool_use_id,
          description: m.description,
          usage: m.usage,
        };
      }
      if (message.subtype === "task_updated") {
        const m = message as { task_id: string; patch: unknown };
        return {
          timestamp,
          type: "system",
          subtype: "task_updated",
          task_id: m.task_id,
          patch: m.patch,
        };
      }
      if (message.subtype === "status") {
        return null;
      }
      return {
        timestamp,
        type: "system",
        subtype: message.subtype,
      };
    }
    case "stream_event":
      return null;
    case "rate_limit_event":
      return null;
    default:
      return {
        timestamp,
        type: (message as { type: string }).type,
      };
  }
}

export class LocalTranscriptWriter implements TranscriptWriter {
  readonly sessionId: string;
  readonly sessionDir: string;
  private readonly filePath: string;
  private buffer: string[] = [];
  private readonly flushThreshold: number;
  private readonly logger: Logger | undefined;
  private closed = false;

  constructor(sessionsDir: string, flushThreshold = 10, logger?: Logger) {
    const { sessionId, sessionDir } = createSessionDir(sessionsDir);
    this.sessionId = sessionId;
    this.sessionDir = sessionDir;
    mkdirSync(this.sessionDir, { recursive: true });
    this.filePath = join(this.sessionDir, "transcript.jsonl");
    this.flushThreshold = flushThreshold;
    this.logger = logger;
  }

  write(event: TranscriptEvent): void {
    if (this.closed) return;
    this.buffer.push(JSON.stringify(event));
    if (this.buffer.length >= this.flushThreshold) {
      this.flush();
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.flush();
  }

  private flush(): void {
    if (this.buffer.length === 0) return;
    const lines = this.buffer;
    this.buffer = [];
    try {
      appendFileSync(this.filePath, lines.join("\n") + "\n");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger?.warn("transcript write failed", { path: this.filePath, error: msg });
      this.buffer = [...lines, ...this.buffer];
      if (this.buffer.length > MAX_BUFFER_LINES) {
        const dropped = this.buffer.length - MAX_BUFFER_LINES;
        this.buffer = this.buffer.slice(dropped);
        this.logger?.warn("transcript buffer overflow, dropping oldest events", {
          path: this.filePath,
          dropped,
        });
      }
    }
  }
}

const MAX_BUFFER_LINES = 10_000;

export class NullTranscriptWriter implements TranscriptWriter {
  write(_event: TranscriptEvent): void {}
  async close(): Promise<void> {}
}
