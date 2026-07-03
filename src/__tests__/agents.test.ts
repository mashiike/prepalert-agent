import { describe, test, expect } from "bun:test";
import { buildRunbookAgents, RUNBOOK_AGENT_PREFIX } from "../commands/agents.js";
import type { Project, Runbook } from "../project.js";

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    dir: "/tmp/test",
    config: { name: "test-project" },
    mcpConfig: { mcpServers: {} },
    runbooks: [],
    ...overrides,
  };
}

function makeRunbook(overrides: Partial<Runbook> = {}): Runbook {
  return {
    id: "web-api/5xx",
    meta: { description: "Check 5xx" },
    body: "1. do the thing",
    ...overrides,
  };
}

describe("buildRunbookAgents", () => {
  test("always includes the built-in Explore agent", () => {
    const agents = buildRunbookAgents(makeProject());
    expect(agents["Explore"]).toBeDefined();
    expect(agents["Explore"]!.model).toBe("haiku");
  });

  test("keys runbook agents with the runbook/ prefix and id", () => {
    const project = makeProject({ runbooks: [makeRunbook({ id: "web-api/5xx" })] });
    const agents = buildRunbookAgents(project);
    expect(agents[`${RUNBOOK_AGENT_PREFIX}web-api/5xx`]).toBeDefined();
  });

  test("includes the runbook body in the prompt", () => {
    const project = makeProject({ runbooks: [makeRunbook({ body: "Check the logs" })] });
    const agents = buildRunbookAgents(project);
    const agent = agents[`${RUNBOOK_AGENT_PREFIX}web-api/5xx`]!;
    expect(agent.prompt).toContain("Check the logs");
  });

  test("includes project instructions in the prompt when configured", () => {
    const project = makeProject({
      config: { name: "test", instructions: "Always respond in Japanese." },
      runbooks: [makeRunbook()],
    });
    const agents = buildRunbookAgents(project);
    const agent = agents[`${RUNBOOK_AGENT_PREFIX}web-api/5xx`]!;
    expect(agent.prompt).toContain("Always respond in Japanese.");
  });

  test("omits project instructions section when not configured", () => {
    const project = makeProject({ runbooks: [makeRunbook()] });
    const agents = buildRunbookAgents(project);
    const agent = agents[`${RUNBOOK_AGENT_PREFIX}web-api/5xx`]!;
    expect(agent.prompt).not.toContain("## Project Instructions");
  });

  test("combines description and trigger", () => {
    const project = makeProject({
      runbooks: [makeRunbook({ meta: { description: "Check 5xx", trigger: "5xx alert" } })],
    });
    const agents = buildRunbookAgents(project);
    const agent = agents[`${RUNBOOK_AGENT_PREFIX}web-api/5xx`]!;
    expect(agent.description).toBe("Check 5xx. trigger: 5xx alert");
  });

  test("omits trigger from description when not set", () => {
    const project = makeProject({ runbooks: [makeRunbook({ meta: { description: "Check 5xx" } })] });
    const agents = buildRunbookAgents(project);
    const agent = agents[`${RUNBOOK_AGENT_PREFIX}web-api/5xx`]!;
    expect(agent.description).toBe("Check 5xx");
  });

  test("runbook model overrides project model", () => {
    const project = makeProject({
      config: { name: "test", model: "sonnet" },
      runbooks: [makeRunbook({ meta: { description: "d", model: "opus" } })],
    });
    const agents = buildRunbookAgents(project);
    expect(agents[`${RUNBOOK_AGENT_PREFIX}web-api/5xx`]!.model).toBe("opus");
  });

  test("falls back to project model when runbook model is not set", () => {
    const project = makeProject({
      config: { name: "test", model: "sonnet" },
      runbooks: [makeRunbook()],
    });
    const agents = buildRunbookAgents(project);
    expect(agents[`${RUNBOOK_AGENT_PREFIX}web-api/5xx`]!.model).toBe("sonnet");
  });

  test("omits model when neither runbook nor project configure one", () => {
    const project = makeProject({ runbooks: [makeRunbook()] });
    const agents = buildRunbookAgents(project);
    expect(agents[`${RUNBOOK_AGENT_PREFIX}web-api/5xx`]!.model).toBeUndefined();
  });

  test("runbook effort overrides project effort", () => {
    const project = makeProject({
      config: { name: "test", effort: "low" },
      runbooks: [makeRunbook({ meta: { description: "d", effort: "high" } })],
    });
    const agents = buildRunbookAgents(project);
    expect(agents[`${RUNBOOK_AGENT_PREFIX}web-api/5xx`]!.effort).toBe("high");
  });

  test("falls back to project effort when runbook effort is not set", () => {
    const project = makeProject({
      config: { name: "test", effort: "medium" },
      runbooks: [makeRunbook()],
    });
    const agents = buildRunbookAgents(project);
    expect(agents[`${RUNBOOK_AGENT_PREFIX}web-api/5xx`]!.effort).toBe("medium");
  });

  test("runbook maxTurns overrides project maxTurns", () => {
    const project = makeProject({
      config: { name: "test", maxTurns: 10 },
      runbooks: [makeRunbook({ meta: { description: "d", maxTurns: 3 } })],
    });
    const agents = buildRunbookAgents(project);
    expect(agents[`${RUNBOOK_AGENT_PREFIX}web-api/5xx`]!.maxTurns).toBe(3);
  });

  test("falls back to project maxTurns when runbook maxTurns is not set", () => {
    const project = makeProject({
      config: { name: "test", maxTurns: 20 },
      runbooks: [makeRunbook()],
    });
    const agents = buildRunbookAgents(project);
    expect(agents[`${RUNBOOK_AGENT_PREFIX}web-api/5xx`]!.maxTurns).toBe(20);
  });

  test("uses runbook allowedTools as agent tools", () => {
    const project = makeProject({
      runbooks: [makeRunbook({ meta: { description: "d", allowedTools: ["Read", "Grep"] } })],
    });
    const agents = buildRunbookAgents(project);
    expect(agents[`${RUNBOOK_AGENT_PREFIX}web-api/5xx`]!.tools).toEqual(["Read", "Grep"]);
  });

  test("uses runbook disallowedTools as agent disallowedTools", () => {
    const project = makeProject({
      runbooks: [makeRunbook({ meta: { description: "d", disallowedTools: ["Bash"] } })],
    });
    const agents = buildRunbookAgents(project);
    expect(agents[`${RUNBOOK_AGENT_PREFIX}web-api/5xx`]!.disallowedTools).toEqual(["Bash"]);
  });

  test("builds one agent per runbook plus Explore", () => {
    const project = makeProject({
      runbooks: [
        makeRunbook({ id: "web-api/5xx" }),
        makeRunbook({ id: "db/connection" }),
      ],
    });
    const agents = buildRunbookAgents(project);
    expect(Object.keys(agents).sort()).toEqual(
      ["Explore", `${RUNBOOK_AGENT_PREFIX}db/connection`, `${RUNBOOK_AGENT_PREFIX}web-api/5xx`].sort(),
    );
  });
});
