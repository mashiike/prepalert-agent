import { describe, test, expect, afterEach } from "bun:test";
import { readFileSync, rmSync, existsSync, readdirSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { LocalTranscriptWriter, NullTranscriptWriter, sdkMessageToEvent } from "../transcript.js";
import type { TranscriptEvent } from "../transcript.js";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";

function makeTmpDir(): string {
  const dir = join(tmpdir(), `transcript-test-${crypto.randomUUID().slice(0, 8)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("LocalTranscriptWriter", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs) {
      if (existsSync(dir)) rmSync(dir, { recursive: true });
    }
    dirs.length = 0;
  });

  test("creates session directory with transcript.jsonl", async () => {
    const dir = makeTmpDir();
    dirs.push(dir);
    const writer = new LocalTranscriptWriter(dir, 1);
    expect(writer.sessionId).toBeTruthy();
    expect(writer.sessionDir).toContain(writer.sessionId);

    const event: TranscriptEvent = { timestamp: "2025-06-16T00:00:00.000Z", type: "user", content: "hello" };
    writer.write(event);
    await writer.close();

    const transcriptPath = join(writer.sessionDir, "transcript.jsonl");
    expect(existsSync(transcriptPath)).toBe(true);

    const content = readFileSync(transcriptPath, "utf-8");
    const lines = content.trim().split("\n");
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]!);
    expect(parsed.type).toBe("user");
    expect(parsed.content).toBe("hello");
  });

  test("buffers writes and flushes on close", async () => {
    const dir = makeTmpDir();
    dirs.push(dir);
    const writer = new LocalTranscriptWriter(dir, 100);
    writer.write({ timestamp: "2025-06-16T00:00:00.000Z", type: "user", content: "1" });
    writer.write({ timestamp: "2025-06-16T00:00:01.000Z", type: "assistant", content: "2" });

    const transcriptPath = join(writer.sessionDir, "transcript.jsonl");
    expect(existsSync(transcriptPath)).toBe(false);

    await writer.close();

    expect(existsSync(transcriptPath)).toBe(true);
    const content = readFileSync(transcriptPath, "utf-8");
    const lines = content.trim().split("\n");
    expect(lines).toHaveLength(2);
  });

  test("flushes when threshold reached", async () => {
    const dir = makeTmpDir();
    dirs.push(dir);
    const writer = new LocalTranscriptWriter(dir, 2);
    writer.write({ timestamp: "2025-06-16T00:00:00.000Z", type: "user", content: "1" });
    writer.write({ timestamp: "2025-06-16T00:00:01.000Z", type: "user", content: "2" });

    const transcriptPath = join(writer.sessionDir, "transcript.jsonl");
    expect(existsSync(transcriptPath)).toBe(true);
    await writer.close();
  });

  test("each writer creates a unique session directory", () => {
    const dir = makeTmpDir();
    dirs.push(dir);
    const writer1 = new LocalTranscriptWriter(dir);
    const writer2 = new LocalTranscriptWriter(dir);
    expect(writer1.sessionId).not.toBe(writer2.sessionId);
    expect(writer1.sessionDir).not.toBe(writer2.sessionDir);
  });
});

describe("NullTranscriptWriter", () => {
  test("does nothing", async () => {
    const writer = new NullTranscriptWriter();
    writer.write({ timestamp: "2025-06-16T00:00:00.000Z", type: "user", content: "hello" });
    await writer.close();
  });
});

describe("sdkMessageToEvent", () => {
  test("converts assistant message with text", () => {
    const msg = {
      type: "assistant" as const,
      message: {
        id: "msg_1",
        type: "message" as const,
        role: "assistant" as const,
        content: [{ type: "text" as const, text: "Hello world" }],
        model: "claude-sonnet-4-20250514",
        stop_reason: "end_turn" as const,
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 20 },
      },
      parent_tool_use_id: null,
      uuid: "uuid-1" as `${string}-${string}-${string}-${string}-${string}`,
      session_id: "session-1",
    } as unknown as SDKMessage;

    const event = sdkMessageToEvent(msg);
    expect(event).not.toBeNull();
    expect(event!.type).toBe("assistant");
    expect(event!["content"]).toBe("Hello world");
  });

  test("converts assistant message with tool_use", () => {
    const msg = {
      type: "assistant" as const,
      message: {
        id: "msg_1",
        type: "message" as const,
        role: "assistant" as const,
        content: [
          { type: "text" as const, text: "Let me check" },
          { type: "tool_use" as const, id: "tool_1", name: "Read", input: { path: "/tmp/test" } },
        ],
        model: "claude-sonnet-4-20250514",
        stop_reason: "tool_use" as const,
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 20 },
      },
      parent_tool_use_id: null,
      uuid: "uuid-1" as `${string}-${string}-${string}-${string}-${string}`,
      session_id: "session-1",
    } as unknown as SDKMessage;

    const event = sdkMessageToEvent(msg);
    expect(event).not.toBeNull();
    expect(event!.type).toBe("assistant");
    expect(event!["content"]).toBe("Let me check");
    expect(event!["tool_use"]).toEqual([{ id: "tool_1", name: "Read", input: { path: "/tmp/test" } }]);
  });

  test("converts user message", () => {
    const msg = {
      type: "user" as const,
      message: { role: "user" as const, content: "What happened?" },
      parent_tool_use_id: null,
    } as unknown as SDKMessage;

    const event = sdkMessageToEvent(msg);
    expect(event).not.toBeNull();
    expect(event!.type).toBe("user");
    expect(event!["content"]).toBe("What happened?");
  });

  test("converts result message", () => {
    const msg = {
      type: "result" as const,
      subtype: "success" as const,
      is_error: false,
      num_turns: 3,
      total_cost_usd: 0.0234,
      duration_ms: 5000,
      duration_api_ms: 4000,
      stop_reason: "end_turn",
      usage: { input_tokens: 100, output_tokens: 200, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, server_tool_use_input_tokens: 0 },
      modelUsage: {},
      result: "done",
      permission_denials: [],
      uuid: "uuid-1" as `${string}-${string}-${string}-${string}-${string}`,
      session_id: "session-1",
    } as unknown as SDKMessage;

    const event = sdkMessageToEvent(msg);
    expect(event).not.toBeNull();
    expect(event!.type).toBe("result");
    expect(event!["total_cost_usd"]).toBe(0.0234);
    expect(event!["num_turns"]).toBe(3);
  });

  test("returns null for stream_event", () => {
    const msg = {
      type: "stream_event" as const,
      event: {},
      parent_tool_use_id: null,
      uuid: "uuid-1" as `${string}-${string}-${string}-${string}-${string}`,
      session_id: "session-1",
    } as unknown as SDKMessage;

    const event = sdkMessageToEvent(msg);
    expect(event).toBeNull();
  });

  test("converts tool_use_summary", () => {
    const msg = {
      type: "tool_use_summary" as const,
      summary: "Read file /tmp/test",
      preceding_tool_use_ids: ["tool_1"],
      uuid: "uuid-1" as `${string}-${string}-${string}-${string}-${string}`,
      session_id: "session-1",
    } as unknown as SDKMessage;

    const event = sdkMessageToEvent(msg);
    expect(event).not.toBeNull();
    expect(event!.type).toBe("tool_use_summary");
    expect(event!["summary"]).toBe("Read file /tmp/test");
  });

  test("returns null for tool_progress", () => {
    const msg = {
      type: "tool_progress" as const,
      tool_use_id: "tool_1",
      tool_name: "Read",
      parent_tool_use_id: null,
      elapsed_time_seconds: 5,
      uuid: "uuid-1" as `${string}-${string}-${string}-${string}-${string}`,
      session_id: "session-1",
    } as unknown as SDKMessage;

    const event = sdkMessageToEvent(msg);
    expect(event).toBeNull();
  });

  test("converts system init message", () => {
    const msg = {
      type: "system" as const,
      subtype: "init" as const,
      model: "claude-sonnet-4-20250514",
      mcp_servers: [{ name: "test", status: "connected" }],
      tools: ["Read", "Grep"],
    } as unknown as SDKMessage;

    const event = sdkMessageToEvent(msg);
    expect(event).not.toBeNull();
    expect(event!.type).toBe("system");
    expect(event!["subtype"]).toBe("init");
    expect(event!["model"]).toBe("claude-sonnet-4-20250514");
  });

  test("drops rate_limit_event", () => {
    const msg = {
      type: "rate_limit_event" as const,
      rate_limit_info: { status: "allowed", utilization: 0.5 },
      uuid: "uuid-1",
      session_id: "session-1",
    } as unknown as SDKMessage;

    const event = sdkMessageToEvent(msg);
    expect(event).toBeNull();
  });

  test("drops thinking_tokens system message", () => {
    const msg = {
      type: "system" as const,
      subtype: "thinking_tokens" as const,
      estimated_tokens: 1500,
      estimated_tokens_delta: 100,
      uuid: "uuid-1",
      session_id: "session-1",
    } as unknown as SDKMessage;

    const event = sdkMessageToEvent(msg);
    expect(event).toBeNull();
  });
});

describe("LocalTranscriptWriter edge cases", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs) {
      if (existsSync(dir)) rmSync(dir, { recursive: true });
    }
    dirs.length = 0;
  });

  test("close is idempotent", async () => {
    const dir = makeTmpDir();
    dirs.push(dir);
    const writer = new LocalTranscriptWriter(dir, 100);
    writer.write({ timestamp: "2025-06-16T00:00:00.000Z", type: "user", content: "hello" });
    await writer.close();
    await writer.close();

    const content = readFileSync(join(writer.sessionDir, "transcript.jsonl"), "utf-8");
    expect(content.trim().split("\n")).toHaveLength(1);
  });

  test("write after close is silently ignored", async () => {
    const dir = makeTmpDir();
    dirs.push(dir);
    const writer = new LocalTranscriptWriter(dir, 100);
    writer.write({ timestamp: "2025-06-16T00:00:00.000Z", type: "user", content: "before" });
    await writer.close();
    writer.write({ timestamp: "2025-06-16T00:00:01.000Z", type: "user", content: "after" });

    const content = readFileSync(join(writer.sessionDir, "transcript.jsonl"), "utf-8");
    const lines = content.trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)["content"]).toBe("before");
  });
});
