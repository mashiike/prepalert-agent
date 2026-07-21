import { describe, test, expect, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildQueryOptions } from "../commands/prompt.js";
import { SessionWriter } from "../session-writer.js";
import type { Project } from "../project.js";

let tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "prompt-test-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  tempDirs = [];
});

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    dir: "/tmp/test",
    config: { name: "test-project" },
    mcpConfig: { mcpServers: {} },
    runbooks: [],
    ...overrides,
  };
}

function makeSessionWriter(): SessionWriter {
  return new SessionWriter(makeTempDir(), null);
}

describe("buildQueryOptions (headless)", () => {
  test("sets permissionMode to dontAsk", () => {
    const options = buildQueryOptions(makeProject(), { mode: "headless" });
    expect(options.permissionMode).toBe("dontAsk");
  });

  test("uses default read-only allowed tools when not configured", () => {
    const options = buildQueryOptions(makeProject(), { mode: "headless" });
    expect(options.allowedTools).toContain("Read");
    expect(options.allowedTools).toContain("Agent");
    expect(options.allowedTools).not.toContain("Edit");
  });

  test("includes mcp server tool globs in default allowed tools", () => {
    const project = makeProject({
      mcpConfig: { mcpServers: { "aws-mcp": { command: "uvx", args: [] } } },
    });
    const options = buildQueryOptions(project, { mode: "headless" });
    expect(options.allowedTools).toContain("mcp__aws-mcp__*");
  });

  test("uses configured allowedTools instead of defaults", () => {
    const project = makeProject({ config: { name: "test", allowedTools: ["Read"] } });
    const options = buildQueryOptions(project, { mode: "headless" });
    expect(options.allowedTools).toEqual(["Read"]);
  });

  test("does not include docs-tools mcp server", () => {
    const options = buildQueryOptions(makeProject(), { mode: "headless" });
    expect(options.mcpServers?.["docs-tools"]).toBeUndefined();
  });

  test("adds session-tools mcp server and allowed tool when sessionWriter is set", () => {
    const writer = makeSessionWriter();
    const options = buildQueryOptions(makeProject(), { mode: "headless", sessionWriter: writer });
    expect(options.mcpServers?.["session-tools"]).toBeDefined();
    expect(options.allowedTools).toContain("mcp__session-tools__*");
  });

  test("omits session-tools when sessionWriter is not set", () => {
    const options = buildQueryOptions(makeProject(), { mode: "headless" });
    expect(options.mcpServers?.["session-tools"]).toBeUndefined();
  });

  test("passes through the abortController when set", () => {
    const controller = new AbortController();
    const options = buildQueryOptions(makeProject(), { mode: "headless", abortController: controller });
    expect(options.abortController).toBe(controller);
  });

  test("merges project mcp servers", () => {
    const project = makeProject({
      mcpConfig: { mcpServers: { "aws-mcp": { command: "uvx", args: [] } } },
    });
    const options = buildQueryOptions(project, { mode: "headless" });
    expect(options.mcpServers?.["aws-mcp"]).toBeDefined();
  });
});

describe("buildQueryOptions (interactive)", () => {
  test("uses the given permissionMode", () => {
    const options = buildQueryOptions(makeProject(), { mode: "interactive", permissionMode: "plan" });
    expect(options.permissionMode).toBe("plan");
  });

  test("includes docs-tools mcp server", () => {
    const options = buildQueryOptions(makeProject(), { mode: "interactive", permissionMode: "default" });
    expect(options.mcpServers?.["docs-tools"]).toBeDefined();
  });

  test("passes through canUseTool when set", () => {
    const canUseTool = async () => ({ behavior: "allow" as const, updatedInput: {} });
    const options = buildQueryOptions(makeProject(), {
      mode: "interactive",
      permissionMode: "default",
      canUseTool,
    });
    expect(options.canUseTool).toBe(canUseTool);
  });

  test("leaves allowedTools unset for default permissionMode without configured tools", () => {
    const options = buildQueryOptions(makeProject(), { mode: "interactive", permissionMode: "default" });
    expect(options.allowedTools).toBeUndefined();
  });

  test("uses default allowed tools plus docs-tools when permissionMode is dontAsk", () => {
    const options = buildQueryOptions(makeProject(), { mode: "interactive", permissionMode: "dontAsk" });
    expect(options.allowedTools).toContain("Read");
    expect(options.allowedTools).toContain("mcp__docs-tools__*");
  });

  test("adds session-tools allowed tool when dontAsk and sessionWriter is set", () => {
    const writer = makeSessionWriter();
    const options = buildQueryOptions(makeProject(), {
      mode: "interactive",
      permissionMode: "dontAsk",
      sessionWriter: writer,
    });
    expect(options.allowedTools).toContain("mcp__session-tools__*");
  });

  test("uses configured allowedTools regardless of permissionMode", () => {
    const project = makeProject({ config: { name: "test", allowedTools: ["Read"] } });
    const options = buildQueryOptions(project, { mode: "interactive", permissionMode: "default" });
    expect(options.allowedTools).toEqual(["Read"]);
  });
});

describe("buildQueryOptions (common)", () => {
  test("includes disallowedTools when configured", () => {
    const project = makeProject({ config: { name: "test", disallowedTools: ["Bash"] } });
    const options = buildQueryOptions(project, { mode: "headless" });
    expect(options.disallowedTools).toEqual(["Bash"]);
  });

  test("uses default maxTurns of 10", () => {
    const options = buildQueryOptions(makeProject(), { mode: "headless" });
    expect(options.maxTurns).toBe(10);
  });

  test("uses configured maxTurns", () => {
    const project = makeProject({ config: { name: "test", maxTurns: 5 } });
    const options = buildQueryOptions(project, { mode: "headless" });
    expect(options.maxTurns).toBe(5);
  });

  test("uses configured costLimit as maxBudgetUsd", () => {
    const project = makeProject({ config: { name: "test", costLimit: 2.5 } });
    const options = buildQueryOptions(project, { mode: "headless" });
    expect(options.maxBudgetUsd).toBe(2.5);
  });

  test("uses configured model", () => {
    const project = makeProject({ config: { name: "test", model: "opus" } });
    const options = buildQueryOptions(project, { mode: "headless" });
    expect(options.model).toBe("opus");
  });

  test("defaults settingSources to project and local", () => {
    const options = buildQueryOptions(makeProject(), { mode: "headless" });
    expect(options.settingSources).toEqual(["project", "local"]);
  });

  test("uses configured settingSources", () => {
    const project = makeProject({ config: { name: "test", settingSources: ["user"] } });
    const options = buildQueryOptions(project, { mode: "headless" });
    expect(options.settingSources).toEqual(["user"]);
  });

  test("includes runbook agents keyed by runbook id", () => {
    const project = makeProject({
      runbooks: [{ id: "web-api/5xx", meta: { description: "Check 5xx" }, body: "steps" }],
    });
    const options = buildQueryOptions(project, { mode: "headless" });
    expect(options.agents?.["runbook/web-api/5xx"]).toBeDefined();
    expect(options.agents?.["Explore"]).toBeDefined();
  });

  test("omits pathToClaudeCodeExecutable when not provided", () => {
    const options = buildQueryOptions(makeProject(), { mode: "headless" });
    expect(options.pathToClaudeCodeExecutable).toBeUndefined();
  });

  test("sets pathToClaudeCodeExecutable when provided (headless)", () => {
    const options = buildQueryOptions(makeProject(), { mode: "headless", claudeExecutablePath: "/opt/prepalert-agent/claude" });
    expect(options.pathToClaudeCodeExecutable).toBe("/opt/prepalert-agent/claude");
  });

  test("sets pathToClaudeCodeExecutable when provided (interactive)", () => {
    const options = buildQueryOptions(makeProject(), { mode: "interactive", permissionMode: "default", claudeExecutablePath: "/opt/prepalert-agent/claude" });
    expect(options.pathToClaudeCodeExecutable).toBe("/opt/prepalert-agent/claude");
  });
});
