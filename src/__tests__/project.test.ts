import { describe, test, expect } from "bun:test";
import { join } from "node:path";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { loadProject } from "../project.js";

async function createTempProject(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "prepalert-test-"));
  for (const [path, content] of Object.entries(files)) {
    const fullPath = join(dir, path);
    await mkdir(join(fullPath, ".."), { recursive: true });
    await writeFile(fullPath, content);
  }
  return dir;
}

describe("loadProject", () => {
  test("loads a valid project with prepalert.yaml and runbooks", async () => {
    const dir = await createTempProject({
      "prepalert.yaml": `name: test-project\nmodel: sonnet\n`,
      "runbooks/web-api/5xx.md": `---\ndescription: 5xx runbook\ntrigger: 5xx alert\n---\n\nCheck logs.`,
    });
    const project = await loadProject(dir);
    expect(project.config.name).toBe("test-project");
    expect(project.config.model).toBe("sonnet");
    expect(project.runbooks).toHaveLength(1);
    expect(project.runbooks[0]!.id).toBe("web-api/5xx");
    expect(project.runbooks[0]!.meta.description).toBe("5xx runbook");
    expect(project.runbooks[0]!.meta.trigger).toBe("5xx alert");
    expect(project.runbooks[0]!.body).toBe("Check logs.");
    await rm(dir, { recursive: true });
  });

  test("throws when prepalert.yaml is missing", async () => {
    const dir = await createTempProject({
      "runbooks/dummy.md": "hello",
    });
    await expect(loadProject(dir)).rejects.toThrow("not found");
    await rm(dir, { recursive: true });
  });

  test("throws when name is missing", async () => {
    const dir = await createTempProject({
      "prepalert.yaml": `model: sonnet\n`,
    });
    await expect(loadProject(dir)).rejects.toThrow('"name" is required');
    await rm(dir, { recursive: true });
  });

  test("throws when name is empty", async () => {
    const dir = await createTempProject({
      "prepalert.yaml": `name: ""\n`,
    });
    await expect(loadProject(dir)).rejects.toThrow('"name" is required');
    await rm(dir, { recursive: true });
  });

  test("throws when instructions and instructionsFile are both set", async () => {
    const dir = await createTempProject({
      "prepalert.yaml": `name: test\ninstructions: hello\ninstructionsFile: inst.md\n`,
      "inst.md": "world",
    });
    await expect(loadProject(dir)).rejects.toThrow("cannot both be set");
    await rm(dir, { recursive: true });
  });

  test("throws when timeout has no unit", async () => {
    const dir = await createTempProject({
      "prepalert.yaml": `name: test\ntimeout: 30\n`,
    });
    await expect(loadProject(dir)).rejects.toThrow('Invalid "timeout"');
    await rm(dir, { recursive: true });
  });

  test("accepts a valid timeout duration", async () => {
    const dir = await createTempProject({
      "prepalert.yaml": `name: test\ntimeout: 30m\n`,
    });
    const project = await loadProject(dir);
    expect(project.config.timeout).toBe("30m");
    await rm(dir, { recursive: true });
  });

  test("loads instructions from instructionsFile", async () => {
    const dir = await createTempProject({
      "prepalert.yaml": `name: test\ninstructionsFile: PREPALERT.md\n`,
      "PREPALERT.md": "Check service-map first.",
    });
    const project = await loadProject(dir);
    expect(project.config.instructions).toBe("Check service-map first.");
    await rm(dir, { recursive: true });
  });

  test("uses custom runbooksDir", async () => {
    const dir = await createTempProject({
      "prepalert.yaml": `name: test\nrunbooksDir: custom-runbooks\n`,
      "custom-runbooks/alert.md": `---\ndescription: custom\n---\n\nDo stuff.`,
    });
    const project = await loadProject(dir);
    expect(project.runbooks).toHaveLength(1);
    expect(project.runbooks[0]!.id).toBe("alert");
    await rm(dir, { recursive: true });
  });

  test("returns empty runbooks when runbooks dir does not exist", async () => {
    const dir = await createTempProject({
      "prepalert.yaml": `name: test\n`,
    });
    const project = await loadProject(dir);
    expect(project.runbooks).toHaveLength(0);
    await rm(dir, { recursive: true });
  });

  test("loads .mcp.json", async () => {
    const dir = await createTempProject({
      "prepalert.yaml": `name: test\n`,
      ".mcp.json": JSON.stringify({
        mcpServers: {
          "aws-mcp": { command: "uvx", args: ["mcp-proxy"] },
        },
      }),
    });
    const project = await loadProject(dir);
    expect(Object.keys(project.mcpConfig.mcpServers)).toEqual(["aws-mcp"]);
    await rm(dir, { recursive: true });
  });

  test("uses custom mcpConfig path", async () => {
    const dir = await createTempProject({
      "prepalert.yaml": `name: test\nmcpConfig: config/mcp.json\n`,
      "config/mcp.json": JSON.stringify({
        mcpServers: {
          custom: { command: "node", args: ["server.js"] },
        },
      }),
    });
    const project = await loadProject(dir);
    expect(Object.keys(project.mcpConfig.mcpServers)).toEqual(["custom"]);
    await rm(dir, { recursive: true });
  });

  test("returns empty mcpServers when .mcp.json is missing", async () => {
    const dir = await createTempProject({
      "prepalert.yaml": `name: test\n`,
    });
    const project = await loadProject(dir);
    expect(project.mcpConfig.mcpServers).toEqual({});
    await rm(dir, { recursive: true });
  });

  test("throws when .mcp.json has no mcpServers key", async () => {
    const dir = await createTempProject({
      "prepalert.yaml": `name: test\n`,
      ".mcp.json": JSON.stringify({}),
    });
    await expect(loadProject(dir)).rejects.toThrow('"mcpServers"');
    await rm(dir, { recursive: true });
  });

  test("throws when .mcp.json mcpServers is not an object", async () => {
    const dir = await createTempProject({
      "prepalert.yaml": `name: test\n`,
      ".mcp.json": JSON.stringify({ foo: 1 }),
    });
    await expect(loadProject(dir)).rejects.toThrow('"mcpServers"');
    await rm(dir, { recursive: true });
  });

  test("loads runbooks recursively from nested directories", async () => {
    const dir = await createTempProject({
      "prepalert.yaml": `name: test\n`,
      "runbooks/web-api/5xx.md": `---\ndescription: a\n---\n\nbody a`,
      "runbooks/web-api/latency.md": `---\ndescription: b\n---\n\nbody b`,
      "runbooks/db/connection.md": `---\ndescription: c\n---\n\nbody c`,
    });
    const project = await loadProject(dir);
    const ids = project.runbooks.map((r) => r.id).sort();
    expect(ids).toEqual(["db/connection", "web-api/5xx", "web-api/latency"]);
    await rm(dir, { recursive: true });
  });

  test("runbook without frontmatter uses body as-is", async () => {
    const dir = await createTempProject({
      "prepalert.yaml": `name: test\n`,
      "runbooks/simple.md": `Just do the thing.`,
    });
    const project = await loadProject(dir);
    expect(project.runbooks[0]!.meta.description).toBe("");
    expect(project.runbooks[0]!.body).toBe("Just do the thing.");
    await rm(dir, { recursive: true });
  });

  test("runbook frontmatter with CRLF line endings is parsed", async () => {
    const dir = await createTempProject({
      "prepalert.yaml": `name: test\n`,
      "runbooks/crlf.md": `---\r\ndescription: crlf runbook\r\n---\r\n\r\nCheck logs.`,
    });
    const project = await loadProject(dir);
    expect(project.runbooks[0]!.meta.description).toBe("crlf runbook");
    expect(project.runbooks[0]!.body).toBe("Check logs.");
    await rm(dir, { recursive: true });
  });

  test("maxTurns and costLimit are loaded", async () => {
    const dir = await createTempProject({
      "prepalert.yaml": `name: test\nmaxTurns: 20\ncostLimit: 2.5\n`,
    });
    const project = await loadProject(dir);
    expect(project.config.maxTurns).toBe(20);
    expect(project.config.costLimit).toBe(2.5);
    await rm(dir, { recursive: true });
  });

  test("effort is loaded from project config", async () => {
    const dir = await createTempProject({
      "prepalert.yaml": `name: test\neffort: high\n`,
    });
    const project = await loadProject(dir);
    expect(project.config.effort).toBe("high");
    await rm(dir, { recursive: true });
  });

  test("runbook frontmatter loads new fields", async () => {
    const dir = await createTempProject({
      "prepalert.yaml": `name: test\n`,
      "runbooks/test.md": `---
description: test runbook
model: haiku
effort: low
maxTurns: 5
costLimit: 0.10
allowedTools:
  - mcp__mackerel__*
  - mcp__aws-mcp__*
disallowedTools:
  - Bash
---

Do investigation.`,
    });
    const project = await loadProject(dir);
    const meta = project.runbooks[0]!.meta;
    expect(meta.description).toBe("test runbook");
    expect(meta.model).toBe("haiku");
    expect(meta.effort).toBe("low");
    expect(meta.maxTurns).toBe(5);
    expect(meta.costLimit).toBe(0.1);
    expect(meta.allowedTools).toEqual(["mcp__mackerel__*", "mcp__aws-mcp__*"]);
    expect(meta.disallowedTools).toEqual(["Bash"]);
    await rm(dir, { recursive: true });
  });

  test("serve config is loaded as nested object", async () => {
    const dir = await createTempProject({
      "prepalert.yaml": `
name: test
serve:
  port: 9090
  syncMode: true
  ecsTaskProtection: "off"
  webhooks:
    - path: /webhook/test
      authType: none
`,
    });
    const project = await loadProject(dir);
    expect(project.config.serve?.port).toBe(9090);
    expect(project.config.serve?.syncMode).toBe(true);
    expect(project.config.serve?.ecsTaskProtection).toBe("off");
    expect(project.config.serve?.webhooks).toHaveLength(1);
    expect(project.config.serve?.webhooks![0]!.path).toBe("/webhook/test");
    expect(project.config.serve?.webhooks![0]!.authType).toBe("none");
    await rm(dir, { recursive: true });
  });
});
