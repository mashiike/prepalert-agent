#!/usr/bin/env bun
import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const NODE_MODULES = join(ROOT, "node_modules");

interface PkgInfo {
  name: string;
  version: string;
  license: string;
  licenseText: string;
  repository: string;
}

const LICENSE_FILE_NAMES = [
  "LICENSE",
  "LICENSE.md",
  "LICENSE.txt",
  "LICENSE-MIT",
  "LICENSE-MIT.txt",
  "LICENSE-APACHE",
  "LICENCE",
  "LICENCE.md",
  "LICENCE.txt",
  "license",
  "license.md",
  "license.txt",
];

async function findLicenseFile(pkgDir: string): Promise<string | undefined> {
  for (const name of LICENSE_FILE_NAMES) {
    try {
      const s = await stat(join(pkgDir, name));
      if (s.isFile()) return join(pkgDir, name);
    } catch {
      continue;
    }
  }
  return undefined;
}

function extractRepo(pkg: Record<string, unknown>): string {
  const repo = pkg["repository"];
  if (typeof repo === "string") return repo;
  if (repo && typeof repo === "object" && "url" in (repo as Record<string, unknown>)) {
    return String((repo as Record<string, string>)["url"]).replace(/^git\+/, "").replace(/\.git$/, "");
  }
  return "";
}

async function collectPackage(pkgDir: string): Promise<PkgInfo | undefined> {
  try {
    const raw = await readFile(join(pkgDir, "package.json"), "utf-8");
    const pkg = JSON.parse(raw) as Record<string, unknown>;
    const name = String(pkg["name"] ?? "");
    if (!name) return undefined;

    const version = String(pkg["version"] ?? "");
    const license = String(pkg["license"] ?? "UNKNOWN");

    let licenseText = "";
    const licenseFile = await findLicenseFile(pkgDir);
    if (licenseFile) {
      licenseText = await readFile(licenseFile, "utf-8");
    }

    return {
      name,
      version,
      license,
      licenseText,
      repository: extractRepo(pkg),
    };
  } catch {
    return undefined;
  }
}

async function* walkScoped(dir: string): AsyncGenerator<string> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith("@")) {
      const scopedDir = join(dir, entry.name);
      const inner = await readdir(scopedDir, { withFileTypes: true });
      for (const sub of inner) {
        if (sub.isDirectory()) yield join(scopedDir, sub.name);
      }
    } else if (!entry.name.startsWith(".")) {
      yield join(dir, entry.name);
    }
  }
}

async function main() {
  const packages: PkgInfo[] = [];

  for await (const pkgDir of walkScoped(NODE_MODULES)) {
    const info = await collectPackage(pkgDir);
    if (info) packages.push(info);
  }

  packages.sort((a, b) => a.name.localeCompare(b.name));

  const lines: string[] = [];
  lines.push("# Third-Party Licenses");
  lines.push("");
  lines.push("This file contains the licenses of third-party packages used by prepalert-agent.");
  lines.push(`Generated: ${new Date().toISOString().split("T")[0]}`);
  lines.push("");

  lines.push("## Summary");
  lines.push("");
  lines.push("| Package | Version | License |");
  lines.push("|---|---|---|");
  for (const pkg of packages) {
    lines.push(`| ${pkg.name} | ${pkg.version} | ${pkg.license} |`);
  }
  lines.push("");

  lines.push("## Full License Texts");
  lines.push("");
  for (const pkg of packages) {
    lines.push(`### ${pkg.name} (${pkg.version})`);
    lines.push("");
    lines.push(`License: ${pkg.license}`);
    if (pkg.repository) {
      lines.push(`Repository: ${pkg.repository}`);
    }
    lines.push("");
    if (pkg.licenseText) {
      lines.push("```");
      lines.push(pkg.licenseText.trimEnd());
      lines.push("```");
    } else {
      lines.push("*(License file not found in package)*");
    }
    lines.push("");
  }

  const output = lines.join("\n");
  await Bun.write(join(ROOT, "THIRD_PARTY_LICENSES.md"), output);

  const count = packages.length;
  const licenses = new Map<string, number>();
  for (const pkg of packages) {
    licenses.set(pkg.license, (licenses.get(pkg.license) ?? 0) + 1);
  }
  console.log(`Generated THIRD_PARTY_LICENSES.md (${count} packages)`);
  for (const [lic, n] of [...licenses.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${lic}: ${n}`);
  }
}

main();
