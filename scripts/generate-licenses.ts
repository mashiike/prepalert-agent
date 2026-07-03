#!/usr/bin/env bun
import { readFile, stat } from "node:fs/promises";
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

function packageDir(name: string): string {
  return join(NODE_MODULES, ...name.split("/"));
}

/**
 * Walks the production dependency tree starting from the root package.json's
 * "dependencies" field, following each package's own "dependencies" and
 * "optionalDependencies". devDependencies are never visited.
 */
async function collectProductionDependencies(): Promise<PkgInfo[]> {
  const rootPkg = JSON.parse(await readFile(join(ROOT, "package.json"), "utf-8")) as Record<string, unknown>;
  const rootDeps = Object.keys((rootPkg["dependencies"] as Record<string, string> | undefined) ?? {});

  const visited = new Set<string>();
  const packages: PkgInfo[] = [];
  const queue = [...rootDeps];

  while (queue.length > 0) {
    const name = queue.shift()!;
    if (visited.has(name)) continue;
    visited.add(name);

    const pkgDir = packageDir(name);
    const info = await collectPackage(pkgDir);
    if (!info) continue;
    packages.push(info);

    let raw: string;
    try {
      raw = await readFile(join(pkgDir, "package.json"), "utf-8");
    } catch {
      continue;
    }
    const pkg = JSON.parse(raw) as Record<string, unknown>;
    const deps = {
      ...(pkg["dependencies"] as Record<string, string> | undefined),
      ...(pkg["optionalDependencies"] as Record<string, string> | undefined),
    };
    for (const dep of Object.keys(deps)) {
      if (!visited.has(dep)) queue.push(dep);
    }
  }

  return packages;
}

async function main() {
  const packages = await collectProductionDependencies();
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
