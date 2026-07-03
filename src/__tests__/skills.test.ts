import { describe, test, expect, afterEach } from "bun:test";
import { mkdtemp, readFile, rm, access, readdir, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  loadAvailableSkills,
  installSkills,
  updateSkills,
  uninstallSkills,
  statusSkills,
} from "../commands/skills.js";

let tempDirs: string[] = [];

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "prepalert-skills-test-"));
  tempDirs.push(dir);
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

describe("loadAvailableSkills", () => {
  test("returns prepalert-agent skill with files including references", async () => {
    const skills = await loadAvailableSkills();
    expect(skills.length).toBeGreaterThanOrEqual(1);
    const pa = skills.find(s => s.name === "prepalert-agent");
    expect(pa).toBeDefined();
    expect(pa!.version).toBeTruthy();
    expect(pa!.description).toBeTruthy();

    const fileNames = pa!.files.map(f => f.relativePath);
    expect(fileNames).toContain("SKILL.md");
    expect(fileNames).toContain(join("references", "instructions-guide.md"));
    expect(fileNames).toContain(join("references", "runbook-template.md"));
  });
});

describe("installSkills", () => {
  test("installs all files and creates metadata", async () => {
    const dir = await createTempDir();
    const results = await installSkills(dir, {});
    const installed = results.filter(r => r.action === "installed");
    expect(installed.length).toBeGreaterThanOrEqual(1);

    expect(await exists(join(dir, "prepalert-agent", "SKILL.md"))).toBe(true);
    expect(await exists(join(dir, "prepalert-agent", "references", "instructions-guide.md"))).toBe(true);
    expect(await exists(join(dir, "prepalert-agent", "references", "runbook-template.md"))).toBe(true);

    const metaPath = join(dir, ".prepalert-agent-skills.json");
    expect(await exists(metaPath)).toBe(true);
    const meta = JSON.parse(await readFile(metaPath, "utf-8"));
    expect(meta.installedBy).toBe("prepalert-agent");
    expect(meta.skills["prepalert-agent"]).toBeDefined();
    expect(meta.skills["prepalert-agent"].version).toBeTruthy();
    expect(meta.skills["prepalert-agent"].installedAt).toBeTruthy();
  });

  test("dry-run does not write files", async () => {
    const dir = await createTempDir();
    const results = await installSkills(dir, { dryRun: true });
    expect(results.some(r => r.action === "installed")).toBe(true);
    expect(await exists(join(dir, "prepalert-agent"))).toBe(false);
    expect(await exists(join(dir, ".prepalert-agent-skills.json"))).toBe(false);
  });

  test("skips already installed skills without --force", async () => {
    const dir = await createTempDir();
    await installSkills(dir, {});
    const results = await installSkills(dir, {});
    expect(results.every(r => r.action === "skipped")).toBe(true);
  });

  test("force overwrites existing skills", async () => {
    const dir = await createTempDir();
    await installSkills(dir, {});
    const results = await installSkills(dir, { force: true });
    expect(results.some(r => r.action === "installed")).toBe(true);
  });

  test("force removes files no longer present in the new version", async () => {
    const dir = await createTempDir();
    await installSkills(dir, {});
    const staleFile = join(dir, "prepalert-agent", "stale-leftover.md");
    await writeFile(staleFile, "old content", "utf-8");
    expect(await exists(staleFile)).toBe(true);

    await installSkills(dir, { force: true });
    expect(await exists(staleFile)).toBe(false);
  });
});

describe("updateSkills", () => {
  test("reports up to date when versions match", async () => {
    const dir = await createTempDir();
    await installSkills(dir, {});
    const results = await updateSkills(dir, {});
    expect(results.every(r => r.action === "skipped")).toBe(true);
  });

  test("updates when version differs", async () => {
    const dir = await createTempDir();
    await installSkills(dir, {});

    const metaPath = join(dir, ".prepalert-agent-skills.json");
    const meta = JSON.parse(await readFile(metaPath, "utf-8"));
    meta.skills["prepalert-agent"].version = "0.0.0";
    await writeFile(metaPath, JSON.stringify(meta), "utf-8");

    const results = await updateSkills(dir, {});
    expect(results.some(r => r.action === "updated")).toBe(true);
  });

  test("reports no managed skills on empty directory", async () => {
    const dir = await createTempDir();
    const results = await updateSkills(dir, {});
    expect(results.some(r => r.action === "skipped" && r.message?.includes("no managed skills"))).toBe(true);
  });

  test("removes files no longer present in the new version", async () => {
    const dir = await createTempDir();
    await installSkills(dir, {});
    const staleFile = join(dir, "prepalert-agent", "stale-leftover.md");
    await writeFile(staleFile, "old content", "utf-8");
    expect(await exists(staleFile)).toBe(true);

    const metaPath = join(dir, ".prepalert-agent-skills.json");
    const meta = JSON.parse(await readFile(metaPath, "utf-8"));
    meta.skills["prepalert-agent"].version = "0.0.0";
    await writeFile(metaPath, JSON.stringify(meta), "utf-8");

    await updateSkills(dir, {});
    expect(await exists(staleFile)).toBe(false);
  });
});

describe("uninstallSkills", () => {
  test("removes managed skills and metadata", async () => {
    const dir = await createTempDir();
    await installSkills(dir, {});
    expect(await exists(join(dir, "prepalert-agent", "SKILL.md"))).toBe(true);

    const results = await uninstallSkills(dir, {});
    expect(results.some(r => r.action === "uninstalled")).toBe(true);
    expect(await exists(join(dir, "prepalert-agent"))).toBe(false);
    expect(await exists(join(dir, ".prepalert-agent-skills.json"))).toBe(false);
  });

  test("does not remove unmanaged files", async () => {
    const dir = await createTempDir();
    await installSkills(dir, {});

    const unmanagedDir = join(dir, "some-other-skill");
    await mkdir(unmanagedDir, { recursive: true });
    await writeFile(join(unmanagedDir, "SKILL.md"), "unmanaged", "utf-8");

    await uninstallSkills(dir, {});
    expect(await exists(join(unmanagedDir, "SKILL.md"))).toBe(true);
  });

  test("dry-run does not delete", async () => {
    const dir = await createTempDir();
    await installSkills(dir, {});
    const results = await uninstallSkills(dir, { dryRun: true });
    expect(results.some(r => r.action === "uninstalled")).toBe(true);
    expect(await exists(join(dir, "prepalert-agent", "SKILL.md"))).toBe(true);
  });
});

describe("statusSkills", () => {
  test("reports not-installed on empty directory", async () => {
    const dir = await createTempDir();
    const statuses = await statusSkills(dir);
    expect(statuses.length).toBeGreaterThanOrEqual(1);
    expect(statuses.every(s => s.status === "not-installed")).toBe(true);
  });

  test("reports up-to-date after install", async () => {
    const dir = await createTempDir();
    await installSkills(dir, {});
    const statuses = await statusSkills(dir);
    const pa = statuses.find(s => s.name === "prepalert-agent");
    expect(pa).toBeDefined();
    expect(pa!.status).toBe("up-to-date");
  });

  test("reports outdated when metadata version differs", async () => {
    const dir = await createTempDir();
    await installSkills(dir, {});

    const metaPath = join(dir, ".prepalert-agent-skills.json");
    const meta = JSON.parse(await readFile(metaPath, "utf-8"));
    meta.skills["prepalert-agent"].version = "0.0.0";
    await writeFile(metaPath, JSON.stringify(meta), "utf-8");

    const statuses = await statusSkills(dir);
    const pa = statuses.find(s => s.name === "prepalert-agent");
    expect(pa).toBeDefined();
    expect(pa!.status).toBe("outdated");
    expect(pa!.installedVersion).toBe("0.0.0");
  });
});
