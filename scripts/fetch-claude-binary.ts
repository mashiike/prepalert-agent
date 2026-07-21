#!/usr/bin/env bun
// Fetches the native `claude` CLI binary that @anthropic-ai/claude-agent-sdk
// spawns as a subprocess, for a given `bun build --compile --target=...`
// platform. Used by the release workflow to ship the binary as a sibling
// file next to the compiled prepalert-agent executable (see RELINKING.md
// and pathToClaudeCodeExecutable in src/index.ts) — bun's --compile cannot
// embed it via `with { type: "file" }` when cross-compiling, since that
// requires the platform package to already be installed on the build host.
import { execFileSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [bunTarget, outputPath] = process.argv.slice(2);
if (!bunTarget || !outputPath) {
  console.error("usage: bun run scripts/fetch-claude-binary.ts <bun-target> <output-path>");
  process.exit(1);
}

const sdkPlatform = bunTarget.replace(/^bun-/, "");
const packageName = `@anthropic-ai/claude-agent-sdk-${sdkPlatform}`;

const sdkPkgPath = "node_modules/@anthropic-ai/claude-agent-sdk/package.json";
const sdkPkg = JSON.parse(readFileSync(sdkPkgPath, "utf-8")) as { optionalDependencies?: Record<string, string> };
const version = sdkPkg.optionalDependencies?.[packageName];
if (!version) {
  console.error(`error: no optionalDependency entry for ${packageName} in ${sdkPkgPath}`);
  process.exit(1);
}

const workDir = mkdtempSync(join(tmpdir(), "fetch-claude-binary-"));
try {
  execFileSync("npm", ["pack", `${packageName}@${version}`, "--pack-destination", workDir], { stdio: "inherit" });
  const tarball = readdirSync(workDir).find((f) => f.endsWith(".tgz"));
  if (!tarball) throw new Error("npm pack did not produce a .tgz file");
  execFileSync("tar", ["xzf", join(workDir, tarball), "-C", workDir]);

  copyFileSync(join(workDir, "package", "claude"), outputPath);
  chmodSync(outputPath, 0o755);
  console.log(`fetched ${packageName}@${version} -> ${outputPath}`);
} finally {
  rmSync(workDir, { recursive: true, force: true });
}
