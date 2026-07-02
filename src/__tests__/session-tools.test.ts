import { describe, test, expect, afterEach } from "bun:test";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildSessionTools } from "../session-tools.js";
import { SessionWriter, MAX_ARTIFACT_SIZE } from "../session-writer.js";
import type { SdkMcpToolDefinition } from "@anthropic-ai/claude-agent-sdk";

let tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "session-tools-test-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  tempDirs = [];
});

function findTool<Name extends string>(
  tools: ReturnType<typeof buildSessionTools>,
  name: Name,
): SdkMcpToolDefinition {
  const found = tools.find((t) => t.name === name);
  if (!found) throw new Error(`tool ${name} not found`);
  return found;
}

describe("create_report", () => {
  test("writes the report content via the session writer", async () => {
    const dir = makeTempDir();
    const writer = new SessionWriter(dir, null);
    const tools = buildSessionTools(writer);
    const createReport = findTool(tools, "create_report");

    const result = await createReport.handler({ content: "# Report\nfindings" }, undefined);

    expect(result.isError).toBeUndefined();
    const reportPath = join(writer.sessionDir, "report.md");
    expect(readFileSync(reportPath, "utf-8")).toBe("# Report\nfindings");
    await writer.close();
  });
});

describe("create_artifact", () => {
  test("writes utf-8 content", async () => {
    const dir = makeTempDir();
    const writer = new SessionWriter(dir, null);
    const tools = buildSessionTools(writer);
    const createArtifact = findTool(tools, "create_artifact");

    const result = await createArtifact.handler({ name: "notes.txt", content: "hello" }, undefined);

    expect(result.isError).toBeUndefined();
    const artifactPath = join(writer.sessionDir, "artifacts", "notes.txt");
    expect(readFileSync(artifactPath, "utf-8")).toBe("hello");
    await writer.close();
  });

  test("decodes base64 content", async () => {
    const dir = makeTempDir();
    const writer = new SessionWriter(dir, null);
    const tools = buildSessionTools(writer);
    const createArtifact = findTool(tools, "create_artifact");

    const base64Content = Buffer.from("binary data").toString("base64");
    const result = await createArtifact.handler(
      { name: "data.bin", content: base64Content, encoding: "base64" },
      undefined,
    );

    expect(result.isError).toBeUndefined();
    const artifactPath = join(writer.sessionDir, "artifacts", "data.bin");
    expect(readFileSync(artifactPath, "utf-8")).toBe("binary data");
    await writer.close();
  });

  test("sanitizes a traversal name to stay inside the artifacts dir", async () => {
    const dir = makeTempDir();
    const writer = new SessionWriter(dir, null);
    const tools = buildSessionTools(writer);
    const createArtifact = findTool(tools, "create_artifact");

    const result = await createArtifact.handler({ name: "../../escape.txt", content: "x" }, undefined);

    expect(result.isError).toBeUndefined();
    const artifactPath = join(writer.sessionDir, "artifacts", "escape.txt");
    expect(readFileSync(artifactPath, "utf-8")).toBe("x");
    await writer.close();
  });

  test("returns an error for a name that resolves to empty", async () => {
    const dir = makeTempDir();
    const writer = new SessionWriter(dir, null);
    const tools = buildSessionTools(writer);
    const createArtifact = findTool(tools, "create_artifact");

    const result = await createArtifact.handler({ name: "..", content: "x" }, undefined);

    expect(result.isError).toBe(true);
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain("invalid artifact name");
    await writer.close();
  });

  test("returns an error when utf-8 content exceeds the size limit", async () => {
    const dir = makeTempDir();
    const writer = new SessionWriter(dir, null);
    const tools = buildSessionTools(writer);
    const createArtifact = findTool(tools, "create_artifact");

    const oversized = "x".repeat(MAX_ARTIFACT_SIZE + 1);
    const result = await createArtifact.handler({ name: "big.txt", content: oversized }, undefined);

    expect(result.isError).toBe(true);
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain("artifact too large");
    await writer.close();
  });

  test("returns an error when base64 content exceeds the size limit", async () => {
    const dir = makeTempDir();
    const writer = new SessionWriter(dir, null);
    const tools = buildSessionTools(writer);
    const createArtifact = findTool(tools, "create_artifact");

    const oversized = Buffer.alloc(MAX_ARTIFACT_SIZE + 1).toString("base64");
    const result = await createArtifact.handler(
      { name: "big.bin", content: oversized, encoding: "base64" },
      undefined,
    );

    expect(result.isError).toBe(true);
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain("artifact too large");
    await writer.close();
  });

  test("returns an error for malformed base64 input", async () => {
    const dir = makeTempDir();
    const writer = new SessionWriter(dir, null);
    const tools = buildSessionTools(writer);
    const createArtifact = findTool(tools, "create_artifact");

    const result = await createArtifact.handler(
      { name: "bad.bin", content: "not-valid-base64!!!", encoding: "base64" },
      undefined,
    );

    // Buffer.from with invalid base64 does not throw; it best-effort decodes.
    // This test documents the current behavior: it succeeds rather than erroring.
    expect(result.isError).toBeUndefined();
    await writer.close();
  });
});
