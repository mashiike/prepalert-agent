import { describe, test, expect, afterEach } from "bun:test";
import { mkdtemp, writeFile, mkdir, rm, readFile, access } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { initProject } from "../commands/init.js";

let tempDirs: string[] = [];

async function createTempDir(files?: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "prepalert-init-test-"));
  tempDirs.push(dir);
  if (files) {
    for (const [path, content] of Object.entries(files)) {
      const fullPath = join(dir, path);
      await mkdir(join(fullPath, ".."), { recursive: true });
      await writeFile(fullPath, content);
    }
  }
  return dir;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

afterEach(async () => {
  for (const dir of tempDirs) {
    await rm(dir, { recursive: true, force: true });
  }
  tempDirs = [];
});

describe("initProject", () => {
  test("creates all files in empty directory", async () => {
    const dir = await createTempDir();
    const result = await initProject(dir);

    expect(result.errors).toEqual([]);
    expect(result.created).toContain("prepalert.yaml");
    expect(result.created).toContain(".mcp.json");
    expect(result.created).toContain("runbooks/example/5xx-rate.md");
    expect(result.created).toContain(".gitignore");

    const yaml = await readFile(join(dir, "prepalert.yaml"), "utf-8");
    expect(yaml).toContain("model: haiku");
    expect(yaml).toContain("maxTurns: 10");
    expect(yaml).toContain("serve:");
    expect(yaml).toContain("/webhook/alert");

    const mcpJson = await readFile(join(dir, ".mcp.json"), "utf-8");
    expect(JSON.parse(mcpJson)).toEqual({ mcpServers: {} });

    expect(await exists(join(dir, "runbooks", "example", "5xx-rate.md"))).toBe(true);

    const gitignore = await readFile(join(dir, ".gitignore"), "utf-8");
    expect(gitignore).toContain("logs/");
    expect(gitignore).toContain("sessions/");
  });

  test("uses directory name as project name", async () => {
    const dir = await createTempDir();
    await initProject(dir);

    const yaml = await readFile(join(dir, "prepalert.yaml"), "utf-8");
    const dirName = dir.split("/").pop()!;
    expect(yaml).toContain(`name: ${dirName}`);
  });

  test("errors when prepalert.yaml already exists", async () => {
    const dir = await createTempDir({ "prepalert.yaml": "name: existing" });
    const result = await initProject(dir);

    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain("already exists");
    expect(result.created).toEqual([]);
  });

  test("skips .mcp.json when already exists", async () => {
    const dir = await createTempDir({ ".mcp.json": '{"mcpServers":{"test":{}}}' });
    const result = await initProject(dir);

    expect(result.errors).toEqual([]);
    expect(result.skipped).toContain(".mcp.json (already exists)");

    const mcpJson = await readFile(join(dir, ".mcp.json"), "utf-8");
    expect(JSON.parse(mcpJson)).toEqual({ mcpServers: { test: {} } });
  });

  test("skips runbooks/example/ when already exists", async () => {
    const dir = await createTempDir({ "runbooks/example/custom.md": "# custom" });
    const result = await initProject(dir);

    expect(result.errors).toEqual([]);
    expect(result.skipped).toContain("runbooks/example/ (already exists)");
  });

  test("appends to .gitignore when entries missing (non-TTY)", async () => {
    const dir = await createTempDir({ ".gitignore": "node_modules/\n" });
    const result = await initProject(dir);

    expect(result.created).toContain(".gitignore (appended: logs/, sessions/)");

    const gitignore = await readFile(join(dir, ".gitignore"), "utf-8");
    expect(gitignore).toContain("node_modules/");
    expect(gitignore).toContain("logs/");
    expect(gitignore).toContain("sessions/");
  });

  test("skips .gitignore when entries already present", async () => {
    const dir = await createTempDir({ ".gitignore": "logs/\nsessions/\n" });
    const result = await initProject(dir);

    expect(result.skipped).toContain(".gitignore (already contains logs/ and sessions/)");
  });

  test("appends only missing entries to .gitignore", async () => {
    const dir = await createTempDir({ ".gitignore": "logs/\n" });
    const result = await initProject(dir);

    expect(result.created).toContain(".gitignore (appended: sessions/)");

    const gitignore = await readFile(join(dir, ".gitignore"), "utf-8");
    expect(gitignore).toContain("sessions/");
  });

  test("generated prepalert.yaml contains commented-out fields", async () => {
    const dir = await createTempDir();
    await initProject(dir);

    const yaml = await readFile(join(dir, "prepalert.yaml"), "utf-8");
    expect(yaml).toContain("# effort: medium");
    expect(yaml).toContain("# costLimit: 1.0");
    expect(yaml).toContain("# timeout: 15m");
    expect(yaml).toContain("# instructions:");
    expect(yaml).toContain("# instructionsFile: PREPALERT.md");
  });

  test("generated runbook has valid frontmatter structure", async () => {
    const dir = await createTempDir();
    await initProject(dir);

    const runbook = await readFile(join(dir, "runbooks", "example", "5xx-rate.md"), "utf-8");
    expect(runbook).toMatch(/^---\n/);
    expect(runbook).toContain("description:");
    expect(runbook).toContain("trigger:");
  });
});
