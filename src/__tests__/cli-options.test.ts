import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveClaudeExecutablePath } from "../cli-options.js";

function makeSiblingDir(withClaude: boolean): string {
  const dir = mkdtempSync(join(tmpdir(), "cli-options-test-"));
  if (withClaude) writeFileSync(join(dir, "claude"), "");
  return dir;
}

describe("resolveClaudeExecutablePath", () => {
  test("prefers the CLI value over everything else", () => {
    const dir = makeSiblingDir(true);
    const result = resolveClaudeExecutablePath("/explicit/claude", { PREPALERT_CLAUDE_EXECUTABLE_PATH: "/from/env" }, join(dir, "prepalert-agent"));
    expect(result).toBe("/explicit/claude");
  });

  test("falls back to the env var when no CLI value is given", () => {
    const dir = makeSiblingDir(true);
    const result = resolveClaudeExecutablePath(undefined, { PREPALERT_CLAUDE_EXECUTABLE_PATH: "/from/env" }, join(dir, "prepalert-agent"));
    expect(result).toBe("/from/env");
  });

  test("detects a sibling claude binary next to a compiled executable", () => {
    const dir = makeSiblingDir(true);
    const result = resolveClaudeExecutablePath(undefined, {}, join(dir, "prepalert-agent"));
    expect(result).toBe(join(dir, "claude"));
  });

  test("returns undefined when no sibling claude binary exists", () => {
    const dir = makeSiblingDir(false);
    const result = resolveClaudeExecutablePath(undefined, {}, join(dir, "prepalert-agent"));
    expect(result).toBeUndefined();
  });

  test("skips sibling detection when running under the bun runtime (dev mode)", () => {
    const dir = makeSiblingDir(true);
    const result = resolveClaudeExecutablePath(undefined, {}, join(dir, "bun"));
    expect(result).toBeUndefined();
  });

  test("skips sibling detection when running under node (dev mode)", () => {
    const dir = makeSiblingDir(true);
    const result = resolveClaudeExecutablePath(undefined, {}, join(dir, "node"));
    expect(result).toBeUndefined();
  });
});
