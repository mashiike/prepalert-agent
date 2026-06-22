import { describe, test, expect } from "bun:test";
import { buildSystemPrompt, RUNBOOK_AGENT_PREFIX } from "../commands/execute.js";
import type { Project } from "../project.js";

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
