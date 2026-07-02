import { describe, test, expect } from "bun:test";
import type { SDKMessage, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import {
  buildSystemPrompt,
  RUNBOOK_AGENT_PREFIX,
  RunbookReportTracker,
  extractToolResults,
} from "../commands/execute.js";
import { NullLogger } from "../logger.js";
import type { TranscriptWriter } from "../transcript.js";
import type { Project } from "../project.js";

function makeAssistantAgentCall(id: string, subagentType: string): SDKMessage {
  return {
    type: "assistant",
    message: {
      content: [
        { type: "tool_use", id, name: "Agent", input: { subagent_type: subagentType } },
      ],
    },
  } as unknown as SDKMessage;
}

function makeAssistantAgentCalls(calls: Array<{ id: string; subagentType: string }>): SDKMessage {
  return {
    type: "assistant",
    message: {
      content: calls.map((c) => ({ type: "tool_use", id: c.id, name: "Agent", input: { subagent_type: c.subagentType } })),
    },
  } as unknown as SDKMessage;
}

function makeUserToolResult(toolUseId: string, content: unknown): SDKUserMessage {
  return {
    type: "user",
    message: {
      content: [{ type: "tool_result", tool_use_id: toolUseId, content }],
    },
  } as unknown as SDKUserMessage;
}

function makeUserToolResults(results: Array<{ toolUseId: string; content: unknown }>): SDKUserMessage {
  return {
    type: "user",
    message: {
      content: results.map((r) => ({ type: "tool_result", tool_use_id: r.toolUseId, content: r.content })),
    },
  } as unknown as SDKUserMessage;
}

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    dir: "/tmp/test",
    config: { name: "test-project" },
    mcpConfig: { mcpServers: {} },
    runbooks: [],
    ...overrides,
  };
}

describe("buildSystemPrompt", () => {
  test("includes prepalert-agent identity", () => {
    const prompt = buildSystemPrompt(makeProject());
    expect(prompt).toContain("prepalert-agent");
    expect(prompt).toContain("SRE agent");
  });

  test("does not hardcode alert-specific language", () => {
    const prompt = buildSystemPrompt(makeProject());
    expect(prompt).not.toContain("An alert has been received");
  });

  test("includes project instructions when set", () => {
    const prompt = buildSystemPrompt(
      makeProject({
        config: { name: "test", instructions: "Always respond in Japanese." },
      }),
    );
    expect(prompt).toContain("## Project Instructions");
    expect(prompt).toContain("Always respond in Japanese.");
  });

  test("omits project instructions section when not set", () => {
    const prompt = buildSystemPrompt(makeProject());
    expect(prompt).not.toContain("## Project Instructions");
  });

  test("does not include runbook catalog XML", () => {
    const prompt = buildSystemPrompt(
      makeProject({
        runbooks: [
          { id: "web-api/5xx", meta: { description: "Check 5xx" }, body: "steps" },
        ],
      }),
    );
    expect(prompt).not.toContain("<runbook-catalog>");
    expect(prompt).not.toContain("web-api/5xx");
  });

  test("instructs to delegate to runbook- prefixed agents", () => {
    const prompt = buildSystemPrompt(makeProject());
    expect(prompt).toContain(RUNBOOK_AGENT_PREFIX);
    expect(prompt).toContain("Agent tool");
  });

  test("includes default maxTurns in environment", () => {
    const prompt = buildSystemPrompt(makeProject());
    expect(prompt).toContain("Max turns: 10");
  });

  test("includes configured maxTurns in environment", () => {
    const prompt = buildSystemPrompt(
      makeProject({ config: { name: "test", maxTurns: 25 } }),
    );
    expect(prompt).toContain("Max turns: 25");
  });

  test("includes costLimit when configured", () => {
    const prompt = buildSystemPrompt(
      makeProject({ config: { name: "test", costLimit: 1.5 } }),
    );
    expect(prompt).toContain("Cost limit: $1.5 USD");
  });

  test("omits costLimit when not configured", () => {
    const prompt = buildSystemPrompt(makeProject());
    expect(prompt).not.toContain("Cost limit");
  });

  test("includes timeout when configured", () => {
    const prompt = buildSystemPrompt(
      makeProject({ config: { name: "test", timeout: "15m" } }),
    );
    expect(prompt).toContain("Timeout: 15m");
  });

  test("includes resource awareness section", () => {
    const prompt = buildSystemPrompt(makeProject());
    expect(prompt).toContain("Resource Awareness");
    expect(prompt).toContain("Turn N/M");
  });
});

describe("extractToolResults", () => {
  test("returns the tool_use_id and text of a single tool_result block", () => {
    const message = makeUserToolResult("toolu_123", "result");
    expect(extractToolResults(message)).toEqual([{ toolUseId: "toolu_123", text: "result" }]);
  });

  test("returns an empty array for string content", () => {
    const message = { type: "user", message: { content: "plain text" } } as unknown as SDKUserMessage;
    expect(extractToolResults(message)).toEqual([]);
  });

  test("returns an empty array when no tool_result block exists", () => {
    const message = {
      type: "user",
      message: { content: [{ type: "text", text: "hello" }] },
    } as unknown as SDKUserMessage;
    expect(extractToolResults(message)).toEqual([]);
  });

  test("extracts text from tool_result with nested text blocks", () => {
    const message = makeUserToolResult("toolu_1", [
      { type: "text", text: "part one " },
      { type: "text", text: "part two" },
    ]);
    expect(extractToolResults(message)).toEqual([{ toolUseId: "toolu_1", text: "part one part two" }]);
  });

  test("returns null text when a tool_result has no text content", () => {
    const message = makeUserToolResult("toolu_1", [{ type: "image", source: {} }]);
    expect(extractToolResults(message)).toEqual([{ toolUseId: "toolu_1", text: null }]);
  });

  test("keeps each tool_result's text independent when a message has multiple results", () => {
    const message = makeUserToolResults([
      { toolUseId: "toolu_a", content: "report A" },
      { toolUseId: "toolu_b", content: "report B" },
    ]);
    expect(extractToolResults(message)).toEqual([
      { toolUseId: "toolu_a", text: "report A" },
      { toolUseId: "toolu_b", text: "report B" },
    ]);
  });
});

describe("RunbookReportTracker", () => {
  function makeFakeWriter(): { writer: TranscriptWriter; calls: { runbookId: string; toolUseId: string; content: string }[] } {
    const calls: { runbookId: string; toolUseId: string; content: string }[] = [];
    const writer = {
      write: () => {},
      close: async () => {},
      writeRunbookReport: async (runbookId: string, toolUseId: string, content: string) => {
        calls.push({ runbookId, toolUseId, content });
      },
    } as unknown as TranscriptWriter;
    return { writer, calls };
  }

  test("saves the result of a runbook agent call as a runbook report", async () => {
    const { writer, calls } = makeFakeWriter();
    const tracker = new RunbookReportTracker(writer, new NullLogger());

    tracker.handleMessage(makeAssistantAgentCall("toolu_1", `${RUNBOOK_AGENT_PREFIX}web-api/5xx`));
    tracker.handleMessage(makeUserToolResult("toolu_1", "# Investigation result"));
    await tracker.flush();

    expect(calls).toEqual([
      { runbookId: "web-api/5xx", toolUseId: "toolu_1", content: "# Investigation result" },
    ]);
  });

  test("saves each report independently when multiple runbook agents are called in parallel", async () => {
    const { writer, calls } = makeFakeWriter();
    const tracker = new RunbookReportTracker(writer, new NullLogger());

    tracker.handleMessage(makeAssistantAgentCalls([
      { id: "toolu_a", subagentType: `${RUNBOOK_AGENT_PREFIX}web-api/5xx` },
      { id: "toolu_b", subagentType: `${RUNBOOK_AGENT_PREFIX}db/conn` },
    ]));
    tracker.handleMessage(makeUserToolResults([
      { toolUseId: "toolu_a", content: "report A" },
      { toolUseId: "toolu_b", content: "report B" },
    ]));
    await tracker.flush();

    expect(calls).toEqual([
      { runbookId: "web-api/5xx", toolUseId: "toolu_a", content: "report A" },
      { runbookId: "db/conn", toolUseId: "toolu_b", content: "report B" },
    ]);
  });

  test("skips a null-text report but still saves a sibling report in the same message", async () => {
    const { writer, calls } = makeFakeWriter();
    const tracker = new RunbookReportTracker(writer, new NullLogger());

    tracker.handleMessage(makeAssistantAgentCalls([
      { id: "toolu_a", subagentType: `${RUNBOOK_AGENT_PREFIX}web-api/5xx` },
      { id: "toolu_b", subagentType: `${RUNBOOK_AGENT_PREFIX}db/conn` },
    ]));
    tracker.handleMessage(makeUserToolResults([
      { toolUseId: "toolu_a", content: [{ type: "image", source: {} }] },
      { toolUseId: "toolu_b", content: "report B" },
    ]));
    await tracker.flush();

    expect(calls).toEqual([
      { runbookId: "db/conn", toolUseId: "toolu_b", content: "report B" },
    ]);
  });

  test("saves the tracked report when an untracked tool_result shares the same message", async () => {
    const { writer, calls } = makeFakeWriter();
    const tracker = new RunbookReportTracker(writer, new NullLogger());

    tracker.handleMessage(makeAssistantAgentCall("toolu_a", `${RUNBOOK_AGENT_PREFIX}web-api/5xx`));
    tracker.handleMessage(makeUserToolResults([
      { toolUseId: "toolu_untracked", content: "some other tool's result" },
      { toolUseId: "toolu_a", content: "report A" },
    ]));
    await tracker.flush();

    expect(calls).toEqual([
      { runbookId: "web-api/5xx", toolUseId: "toolu_a", content: "report A" },
    ]);
  });

  test("ignores non-runbook agent calls", async () => {
    const { writer, calls } = makeFakeWriter();
    const tracker = new RunbookReportTracker(writer, new NullLogger());

    tracker.handleMessage(makeAssistantAgentCall("toolu_2", "Explore"));
    tracker.handleMessage(makeUserToolResult("toolu_2", "explore result"));
    await tracker.flush();

    expect(calls).toEqual([]);
  });

  test("ignores tool results without a pending runbook call", async () => {
    const { writer, calls } = makeFakeWriter();
    const tracker = new RunbookReportTracker(writer, new NullLogger());

    tracker.handleMessage(makeUserToolResult("toolu_unknown", "orphan result"));
    await tracker.flush();

    expect(calls).toEqual([]);
  });

  test("does nothing when the writer does not support runbook reports", async () => {
    const writer = { write: () => {}, close: async () => {} } as unknown as TranscriptWriter;
    const tracker = new RunbookReportTracker(writer, new NullLogger());

    tracker.handleMessage(makeAssistantAgentCall("toolu_3", `${RUNBOOK_AGENT_PREFIX}db/conn`));
    tracker.handleMessage(makeUserToolResult("toolu_3", "result"));
    await tracker.flush();
  });
});
