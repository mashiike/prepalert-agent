import { describe, test, expect, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SessionWriter, validateArtifactName, validateArtifactSize, MAX_ARTIFACT_SIZE } from "../session-writer.js";
import type { SessionStorage, SessionMetadata, ListSessionsResult, ExportUrlResult } from "../storage.js";
import type { TranscriptWriter } from "../transcript.js";

let tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "session-writer-test-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  tempDirs = [];
});

class MockStorage implements SessionStorage {
  written: { method: string; id: string; args: unknown[] }[] = [];

  async listSessions(): Promise<ListSessionsResult> { return { sessions: [] }; }
  async getSession(): Promise<SessionMetadata | null> { return null; }
  async readReport(): Promise<string | null> { return null; }
  async listArtifacts(): Promise<string[]> { return []; }
  async readArtifact(): Promise<Uint8Array | null> { return null; }
  async readTranscript(): Promise<unknown[]> { return []; }
  async listRunbooks(): Promise<{ runbookId: string; toolUseId: string }[]> { return []; }
  async readRunbookReport(): Promise<string | null> { return null; }
  async getExportUrl(): Promise<ExportUrlResult> { return { type: "direct" }; }
  async exportAsZip(): Promise<Uint8Array> { return new Uint8Array(); }

  async writeMetadata(id: string, metadata: Omit<SessionMetadata, "id">): Promise<void> {
    this.written.push({ method: "writeMetadata", id, args: [metadata] });
  }
  async writeReport(id: string, content: string): Promise<void> {
    this.written.push({ method: "writeReport", id, args: [content] });
  }
  async writeArtifact(id: string, name: string, content: Uint8Array): Promise<void> {
    this.written.push({ method: "writeArtifact", id, args: [name, content] });
  }
  async writeRunbookReport(id: string, runbookId: string, toolUseId: string, content: Uint8Array): Promise<void> {
    this.written.push({ method: "writeRunbookReport", id, args: [runbookId, toolUseId, content] });
  }
  async writeTranscript(id: string, content: Uint8Array): Promise<void> {
    this.written.push({ method: "writeTranscript", id, args: [content] });
  }
}

describe("SessionWriter", () => {
  test("creates session directory with date partition", () => {
    const dir = makeTempDir();
    const writer = new SessionWriter(dir, null);
    expect(writer.sessionId).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(writer.sessionDir).toContain(dir);
    expect(existsSync(writer.sessionDir)).toBe(true);
  });

  test("implements TranscriptWriter interface", () => {
    const dir = makeTempDir();
    const writer: TranscriptWriter = new SessionWriter(dir, null);
    expect(typeof writer.write).toBe("function");
    expect(typeof writer.close).toBe("function");
  });

  test("buffers transcript events and flushes to local file", async () => {
    const dir = makeTempDir();
    const writer = new SessionWriter(dir, null, { flushThreshold: 2 });

    writer.write({ timestamp: "t1", type: "user" });
    const transcriptPath = join(writer.sessionDir, "transcript.jsonl");
    expect(existsSync(transcriptPath)).toBe(false);

    writer.write({ timestamp: "t2", type: "assistant" });
    expect(existsSync(transcriptPath)).toBe(true);
    const lines = readFileSync(transcriptPath, "utf-8").trim().split("\n");
    expect(lines.length).toBe(2);

    await writer.close();
  });

  test("flushes remaining buffer on close", async () => {
    const dir = makeTempDir();
    const writer = new SessionWriter(dir, null, { flushThreshold: 100 });

    writer.write({ timestamp: "t1", type: "user" });
    await writer.close();

    const transcriptPath = join(writer.sessionDir, "transcript.jsonl");
    const lines = readFileSync(transcriptPath, "utf-8").trim().split("\n");
    expect(lines.length).toBe(1);
  });

  test("retains buffered events when a flush fails and writes them on the next successful flush", async () => {
    const dir = makeTempDir();
    const writer = new SessionWriter(dir, null, { flushThreshold: 1 });
    const transcriptPath = join(writer.sessionDir, "transcript.jsonl");

    mkdirSync(transcriptPath);
    writer.write({ timestamp: "t1", type: "user" });

    rmSync(transcriptPath, { recursive: true });
    writer.write({ timestamp: "t2", type: "assistant" });

    const lines = readFileSync(transcriptPath, "utf-8").trim().split("\n");
    expect(lines.length).toBe(2);
    expect(lines[0]).toContain("t1");
    expect(lines[1]).toContain("t2");

    await writer.close();
  });

  test("write after close is silently ignored", async () => {
    const dir = makeTempDir();
    const writer = new SessionWriter(dir, null, { flushThreshold: 1 });
    await writer.close();
    writer.write({ timestamp: "t1", type: "user" });
  });

  test("idempotent close", async () => {
    const dir = makeTempDir();
    const writer = new SessionWriter(dir, null);
    await writer.close();
    await writer.close();
  });

  test("writeReport writes to local file", async () => {
    const dir = makeTempDir();
    const writer = new SessionWriter(dir, null);
    await writer.writeReport("# Report\nTest content");
    const content = readFileSync(join(writer.sessionDir, "report.md"), "utf-8");
    expect(content).toBe("# Report\nTest content");
    await writer.close();
  });

  test("writeArtifact writes to local file", async () => {
    const dir = makeTempDir();
    const writer = new SessionWriter(dir, null);
    const data = new TextEncoder().encode("csv,data");
    await writer.writeArtifact("data.csv", data);
    const content = readFileSync(join(writer.sessionDir, "artifacts", "data.csv"), "utf-8");
    expect(content).toBe("csv,data");
    await writer.close();
  });

  test("writeMetadata writes to local file", async () => {
    const dir = makeTempDir();
    const writer = new SessionWriter(dir, null);
    await writer.writeMetadata({ createdAt: "2026-06-18T00:00:00Z", status: "running" });
    const content = readFileSync(join(writer.sessionDir, "metadata.json"), "utf-8");
    const parsed = JSON.parse(content);
    expect(parsed.status).toBe("running");
    await writer.close();
  });

  describe("with storage", () => {
    test("writeReport delegates to storage", async () => {
      const dir = makeTempDir();
      const storage = new MockStorage();
      const writer = new SessionWriter(dir, storage);
      await writer.writeReport("# Report");

      expect(existsSync(join(writer.sessionDir, "report.md"))).toBe(true);
      const storageWrite = storage.written.find(w => w.method === "writeReport");
      expect(storageWrite).toBeDefined();
      expect(storageWrite!.id).toBe(writer.sessionId);
      expect(storageWrite!.args[0]).toBe("# Report");
      await writer.close();
    });

    test("writeArtifact delegates to storage", async () => {
      const dir = makeTempDir();
      const storage = new MockStorage();
      const writer = new SessionWriter(dir, storage);
      const data = new TextEncoder().encode("test");
      await writer.writeArtifact("test.txt", data);

      const storageWrite = storage.written.find(w => w.method === "writeArtifact");
      expect(storageWrite).toBeDefined();
      expect(storageWrite!.args[0]).toBe("test.txt");
      await writer.close();
    });

    test("finalize uploads transcript to storage", async () => {
      const dir = makeTempDir();
      const storage = new MockStorage();
      const writer = new SessionWriter(dir, storage, { flushThreshold: 1 });

      writer.write({ timestamp: "t1", type: "user", content: "hello" });
      await writer.close();

      const storageWrite = storage.written.find(w => w.method === "writeTranscript");
      expect(storageWrite).toBeDefined();
      expect(storageWrite!.id).toBe(writer.sessionId);
    });

    test("finalize does not upload transcript when storage is null", async () => {
      const dir = makeTempDir();
      const writer = new SessionWriter(dir, null, { flushThreshold: 1 });

      writer.write({ timestamp: "t1", type: "user" });
      await writer.close();
    });
  });

  describe("writeRunbookReport", () => {
    test("writes runbook report to local filesystem", async () => {
      const dir = makeTempDir();
      const writer = new SessionWriter(dir, null);
      await writer.writeRunbookReport("web-api-5xx", "toolu_abc123", "# Investigation\nFound 5xx errors.");

      const reportPath = join(writer.sessionDir, "runbooks", "web-api-5xx", "toolu_abc123", "report.md");
      expect(existsSync(reportPath)).toBe(true);
      expect(readFileSync(reportPath, "utf-8")).toBe("# Investigation\nFound 5xx errors.");
      await writer.close();
    });

    test("supports multiple calls for same runbook with different tool_use_ids", async () => {
      const dir = makeTempDir();
      const writer = new SessionWriter(dir, null);
      await writer.writeRunbookReport("web-api-5xx", "toolu_call1", "First investigation");
      await writer.writeRunbookReport("web-api-5xx", "toolu_call2", "Second investigation");

      const report1 = join(writer.sessionDir, "runbooks", "web-api-5xx", "toolu_call1", "report.md");
      const report2 = join(writer.sessionDir, "runbooks", "web-api-5xx", "toolu_call2", "report.md");
      expect(readFileSync(report1, "utf-8")).toBe("First investigation");
      expect(readFileSync(report2, "utf-8")).toBe("Second investigation");
      await writer.close();
    });

    test("sanitizes runbook ID with slashes", async () => {
      const dir = makeTempDir();
      const writer = new SessionWriter(dir, null);
      await writer.writeRunbookReport("web-api/5xx-rate-over-limit", "toolu_abc", "# Report");

      const reportPath = join(writer.sessionDir, "runbooks", "web-api--5xx-rate-over-limit", "toolu_abc", "report.md");
      expect(existsSync(reportPath)).toBe(true);
      expect(readFileSync(reportPath, "utf-8")).toBe("# Report");
      await writer.close();
    });

    test("delegates to storage when configured", async () => {
      const dir = makeTempDir();
      const storage = new MockStorage();
      const writer = new SessionWriter(dir, storage);
      await writer.writeRunbookReport("db-conn", "toolu_xyz", "# DB Report");

      const storageWrite = storage.written.find(w => w.method === "writeRunbookReport");
      expect(storageWrite).toBeDefined();
      expect(storageWrite!.args[0]).toBe("db-conn");
      expect(storageWrite!.args[1]).toBe("toolu_xyz");
      await writer.close();
    });

    test("rejects a runbook ID that resolves to '..'", async () => {
      const dir = makeTempDir();
      const writer = new SessionWriter(dir, null);
      await expect(writer.writeRunbookReport("..", "toolu_abc", "# Report")).rejects.toThrow(
        "invalid runbook id",
      );
      await writer.close();
    });

    test("rejects a runbook ID that resolves to '.'", async () => {
      const dir = makeTempDir();
      const writer = new SessionWriter(dir, null);
      await expect(writer.writeRunbookReport(".", "toolu_abc", "# Report")).rejects.toThrow(
        "invalid runbook id",
      );
      await writer.close();
    });

    test("rejects an empty runbook ID", async () => {
      const dir = makeTempDir();
      const writer = new SessionWriter(dir, null);
      await expect(writer.writeRunbookReport("", "toolu_abc", "# Report")).rejects.toThrow(
        "invalid runbook id",
      );
      await writer.close();
    });
  });

  test("writeArtifact with traversal name stays inside artifacts dir", async () => {
    const dir = makeTempDir();
    const writer = new SessionWriter(dir, null);
    const data = new TextEncoder().encode("x");
    await writer.writeArtifact("../../escape.txt", data);

    expect(existsSync(join(writer.sessionDir, "artifacts", "escape.txt"))).toBe(true);
    expect(existsSync(join(writer.sessionDir, "escape.txt"))).toBe(false);
    expect(existsSync(join(dir, "escape.txt"))).toBe(false);
    await writer.close();
  });

  test("each writer gets unique session directory", () => {
    const dir = makeTempDir();
    const w1 = new SessionWriter(dir, null);
    const w2 = new SessionWriter(dir, null);
    expect(w1.sessionId).not.toBe(w2.sessionId);
    expect(w1.sessionDir).not.toBe(w2.sessionDir);
  });
});

describe("validateArtifactName", () => {
  test("accepts a plain file name", () => {
    expect(validateArtifactName("data.csv")).toBe("data.csv");
  });

  test("strips directory components from traversal paths", () => {
    expect(validateArtifactName("../../etc/passwd")).toBe("passwd");
    expect(validateArtifactName("dir/sub/file.txt")).toBe("file.txt");
    expect(validateArtifactName("/absolute/path.md")).toBe("path.md");
  });

  test("rejects empty and dot-only names", () => {
    expect(() => validateArtifactName("")).toThrow("invalid artifact name");
    expect(() => validateArtifactName(".")).toThrow("invalid artifact name");
    expect(() => validateArtifactName("..")).toThrow("invalid artifact name");
    expect(() => validateArtifactName("a/..")).toThrow("invalid artifact name");
  });

  test("rejects dotfiles", () => {
    expect(() => validateArtifactName(".hidden")).toThrow("invalid artifact name");
    expect(() => validateArtifactName("dir/.env")).toThrow("invalid artifact name");
  });
});

describe("validateArtifactSize", () => {
  test("accepts content at the size limit", () => {
    validateArtifactSize(new Uint8Array(MAX_ARTIFACT_SIZE));
  });

  test("rejects content over the size limit", () => {
    expect(() => validateArtifactSize(new Uint8Array(MAX_ARTIFACT_SIZE + 1))).toThrow("artifact too large");
  });
});
