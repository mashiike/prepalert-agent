import { mkdir, readFile, writeFile, rm, access } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { createInterface } from "node:readline";
import { homedir } from "node:os";
import { Command } from "commander";
import pkg from "../../package.json" with { type: "json" };
import { EMBEDDED_SKILLS } from "../embedded-assets.js";

const MANAGER_NAME = "prepalert-agent";
const METADATA_FILE = ".prepalert-agent-skills.json";

export interface SkillFile {
  relativePath: string;
  content: string;
}

export interface SkillDefinition {
  name: string;
  version: string;
  description: string;
  files: SkillFile[];
}

interface SkillInstallMetadata {
  version: string;
  installedAt: string;
}

interface SkillsMetadataFile {
  installedBy: string;
  skills: Record<string, SkillInstallMetadata>;
}

interface ActionResult {
  action: "installed" | "updated" | "uninstalled" | "skipped";
  name: string;
  message?: string;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function parseSkillFrontmatter(content: string): { name: string | undefined; version: string | undefined; description: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return { name: undefined, version: undefined, description: "" };
  const yaml = match[1];
  if (!yaml) return { name: undefined, version: undefined, description: "" };
  const name = yaml.match(/^name:\s*(.+)$/m)?.[1]?.trim();
  const version = yaml.match(/^version:\s*"?(.+?)"?\s*$/m)?.[1]?.trim();
  const descMatch = yaml.match(/^description:\s*\|?\s*\n([\s\S]*?)(?=\n\w|\n---)/m);
  const descSingle = yaml.match(/^description:\s*(.+)$/m)?.[1]?.trim();
  const description = descMatch?.[1] ? descMatch[1].trim() : (descSingle ?? "");
  return { name, version, description };
}

export async function loadAvailableSkills(): Promise<SkillDefinition[]> {
  const skillMap = new Map<string, SkillFile[]>();
  for (const [key, content] of Object.entries(EMBEDDED_SKILLS)) {
    const slashIdx = key.indexOf("/");
    if (slashIdx < 0) continue;
    const skillName = key.slice(0, slashIdx);
    const relativePath = key.slice(slashIdx + 1);
    if (!skillMap.has(skillName)) skillMap.set(skillName, []);
    skillMap.get(skillName)!.push({ relativePath, content });
  }
  const skills: SkillDefinition[] = [];
  for (const [dirName, files] of skillMap) {
    const skillMd = files.find(f => f.relativePath === "SKILL.md");
    if (!skillMd) continue;
    const frontmatter = parseSkillFrontmatter(skillMd.content);
    skills.push({
      name: frontmatter.name ?? dirName,
      version: frontmatter.version ?? pkg.version,
      description: frontmatter.description,
      files,
    });
  }
  return skills;
}

async function readMetadata(targetDir: string): Promise<SkillsMetadataFile | undefined> {
  const metaPath = join(targetDir, METADATA_FILE);
  if (!(await exists(metaPath))) return undefined;
  try {
    const raw = await readFile(metaPath, "utf-8");
    return JSON.parse(raw) as SkillsMetadataFile;
  } catch {
    return undefined;
  }
}

async function writeMetadata(targetDir: string, meta: SkillsMetadataFile): Promise<void> {
  await writeFile(join(targetDir, METADATA_FILE), JSON.stringify(meta, null, 2) + "\n", "utf-8");
}

function resolveTargetDir(scope: string): string {
  if (scope === "project") return resolve(".claude", "skills");
  if (scope === "user") return join(homedir(), ".claude", "skills");
  return resolve(scope);
}

async function resolveScope(scope: string | undefined): Promise<string> {
  if (scope !== undefined) {
    if (scope !== "project" && scope !== "user") {
      console.error(`error: invalid --scope '${scope}' (expected "project" or "user")`);
      process.exit(1);
    }
    return scope;
  }
  if (!process.stdin.isTTY) {
    throw new Error("--scope is required in non-interactive mode (project or user)");
  }
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  const question = (prompt: string): Promise<string> =>
    new Promise((res) => rl.question(prompt, res));
  try {
    console.error("? Select installation scope:");
    console.error("  (1) project — .claude/skills/ (project local)");
    console.error("  (2) user    — ~/.claude/skills/ (user global)");
    console.error("  (3) other   — enter a path directly");
    for (;;) {
      const answer = (await question("> ")).trim();
      if (answer === "1" || answer === "project") return "project";
      if (answer === "2" || answer === "user") return "user";
      if (answer === "3" || answer === "other") {
        const path = (await question("path> ")).trim();
        if (path) return path;
        console.error("please enter a non-empty path");
        continue;
      }
      console.error("please answer 1, 2, or 3");
    }
  } finally {
    rl.close();
  }
}

export async function installSkills(targetDir: string, options: { dryRun?: boolean; force?: boolean }): Promise<ActionResult[]> {
  const skills = await loadAvailableSkills();
  const meta = await readMetadata(targetDir) ?? { installedBy: MANAGER_NAME, skills: {} };
  const results: ActionResult[] = [];

  for (const skill of skills) {
    const existing = meta.skills[skill.name];
    if (existing && !options.force) {
      results.push({ action: "skipped", name: skill.name, message: `already installed (v${existing.version})` });
      continue;
    }

    if (options.dryRun) {
      results.push({ action: "installed", name: skill.name, message: "dry-run" });
      continue;
    }

    for (const file of skill.files) {
      const dest = join(targetDir, skill.name, file.relativePath);
      await mkdir(dirname(dest), { recursive: true });
      await writeFile(dest, file.content, "utf-8");
    }
    meta.skills[skill.name] = { version: skill.version, installedAt: new Date().toISOString() };
    results.push({ action: "installed", name: skill.name });
  }

  if (!options.dryRun) {
    await mkdir(targetDir, { recursive: true });
    await writeMetadata(targetDir, meta);
  }
  return results;
}

export async function updateSkills(targetDir: string, options: { dryRun?: boolean }): Promise<ActionResult[]> {
  const skills = await loadAvailableSkills();
  const meta = await readMetadata(targetDir);
  if (!meta) return [{ action: "skipped", name: "*", message: "no managed skills found (run install first)" }];

  const results: ActionResult[] = [];
  for (const skill of skills) {
    const existing = meta.skills[skill.name];
    if (!existing) {
      results.push({ action: "skipped", name: skill.name, message: "not installed" });
      continue;
    }
    if (existing.version === skill.version) {
      results.push({ action: "skipped", name: skill.name, message: `up to date (v${skill.version})` });
      continue;
    }

    if (options.dryRun) {
      results.push({ action: "updated", name: skill.name, message: `v${existing.version} → v${skill.version} (dry-run)` });
      continue;
    }

    for (const file of skill.files) {
      const dest = join(targetDir, skill.name, file.relativePath);
      await mkdir(dirname(dest), { recursive: true });
      await writeFile(dest, file.content, "utf-8");
    }
    meta.skills[skill.name] = { version: skill.version, installedAt: new Date().toISOString() };
    results.push({ action: "updated", name: skill.name, message: `v${existing.version} → v${skill.version}` });
  }

  if (!options.dryRun) {
    await writeMetadata(targetDir, meta);
  }
  return results;
}

export async function uninstallSkills(targetDir: string, options: { dryRun?: boolean }): Promise<ActionResult[]> {
  const meta = await readMetadata(targetDir);
  if (!meta) return [{ action: "skipped", name: "*", message: "no managed skills found" }];

  const results: ActionResult[] = [];
  for (const [name, _info] of Object.entries(meta.skills)) {
    const skillDir = join(targetDir, name);
    if (options.dryRun) {
      results.push({ action: "uninstalled", name, message: "dry-run" });
      continue;
    }

    if (await exists(skillDir)) {
      await rm(skillDir, { recursive: true, force: true });
    }
    delete meta.skills[name];
    results.push({ action: "uninstalled", name });
  }

  if (!options.dryRun) {
    if (Object.keys(meta.skills).length === 0) {
      const metaPath = join(targetDir, METADATA_FILE);
      if (await exists(metaPath)) {
        await rm(metaPath);
      }
    } else {
      await writeMetadata(targetDir, meta);
    }
  }
  return results;
}

export interface SkillStatus {
  name: string;
  installedVersion?: string;
  availableVersion: string;
  status: "up-to-date" | "outdated" | "not-installed";
}

export async function statusSkills(targetDir: string): Promise<SkillStatus[]> {
  const skills = await loadAvailableSkills();
  const meta = await readMetadata(targetDir);
  const statuses: SkillStatus[] = [];

  for (const skill of skills) {
    const existing = meta?.skills[skill.name];
    if (!existing) {
      statuses.push({ name: skill.name, availableVersion: skill.version, status: "not-installed" });
    } else if (existing.version === skill.version) {
      statuses.push({ name: skill.name, installedVersion: existing.version, availableVersion: skill.version, status: "up-to-date" });
    } else {
      statuses.push({ name: skill.name, installedVersion: existing.version, availableVersion: skill.version, status: "outdated" });
    }
  }
  return statuses;
}

function printResults(results: ActionResult[], verb: string, dryRun: boolean): void {
  for (const r of results) {
    const suffix = r.message ? ` — ${r.message}` : "";
    if (r.action === "skipped") {
      console.log(`  skipped: ${r.name}${suffix}`);
    } else {
      const dryLabel = dryRun ? " (dry-run)" : "";
      console.log(`  ${verb}${dryLabel}: ${r.name}${suffix}`);
    }
  }
  if (dryRun) {
    console.log("\n[dry-run] no changes were made");
  }
}

export function createSkillsCommand(): Command {
  const skills = new Command("skills")
    .description("Manage prepalert-agent skills for Claude Code and other agent tools");

  skills
    .command("list")
    .description("Show available skills")
    .action(async () => {
      const available = await loadAvailableSkills();
      if (available.length === 0) {
        console.log("no skills found");
        return;
      }
      for (const s of available) {
        const desc = s.description.split("\n")[0];
        console.log(`  ${s.name} (v${s.version}) — ${desc}`);
      }
    });

  skills
    .command("install")
    .description("Install skills")
    .option("--scope <scope>", "installation scope: project or user")
    .option("--dry-run", "preview changes without applying")
    .option("--force", "overwrite existing skills")
    .action(async (opts) => {
      const scope = await resolveScope(opts.scope as string | undefined);
      const targetDir = resolveTargetDir(scope);
      const dryRun = opts.dryRun === true;
      const force = opts.force === true;
      const results = await installSkills(targetDir, { dryRun, force });
      printResults(results, "installed", dryRun);
    });

  skills
    .command("update")
    .description("Update installed skills to latest version")
    .option("--scope <scope>", "installation scope: project or user")
    .option("--dry-run", "preview changes without applying")
    .action(async (opts) => {
      const scope = await resolveScope(opts.scope as string | undefined);
      const targetDir = resolveTargetDir(scope);
      const dryRun = opts.dryRun === true;
      const results = await updateSkills(targetDir, { dryRun });
      printResults(results, "updated", dryRun);
    });

  skills
    .command("uninstall")
    .description("Remove managed skills")
    .option("--scope <scope>", "installation scope: project or user")
    .option("--dry-run", "preview changes without applying")
    .action(async (opts) => {
      const scope = await resolveScope(opts.scope as string | undefined);
      const targetDir = resolveTargetDir(scope);
      const dryRun = opts.dryRun === true;
      const results = await uninstallSkills(targetDir, { dryRun });
      printResults(results, "uninstalled", dryRun);
    });

  skills
    .command("status")
    .description("Show installation status of skills")
    .option("--scope <scope>", "installation scope: project or user")
    .action(async (opts) => {
      const scope = await resolveScope(opts.scope as string | undefined);
      const targetDir = resolveTargetDir(scope);
      const statuses = await statusSkills(targetDir);
      for (const s of statuses) {
        switch (s.status) {
          case "not-installed":
            console.log(`  ${s.name}: not installed (available v${s.availableVersion})`);
            break;
          case "up-to-date":
            console.log(`  ${s.name}: installed v${s.installedVersion} (up to date)`);
            break;
          case "outdated":
            console.log(`  ${s.name}: installed v${s.installedVersion} → available v${s.availableVersion}`);
            break;
        }
      }
    });

  return skills;
}
