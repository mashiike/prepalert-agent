import { describe, test, expect, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { handleApiRequest, type ApiContext } from "../api.js";
import { LocalSessionStorage } from "../storage.js";
import { NullLogger } from "../logger.js";

let tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "api-test-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  tempDirs = [];
});

function makeCtx(sessionsDir: string): ApiContext {
  return {
    storage: new LocalSessionStorage(sessionsDir),
    logger: new NullLogger(),
    exportSecret: new TextEncoder().encode("test-secret"),
    baseUrl: "http://localhost:8080",
  };
}

function makeRequest(path: string): { request: Request; url: URL } {
  const url = new URL(`http://localhost:8080${path}`);
  const request = new Request(url.toString());
  return { request, url };
}

function createSession(sessionsDir: string, sessionId: string, files: Record<string, string>): void {
  const match = sessionId.match(/^(\d{4})-(\d{2})-(\d{2})T/);
  let sessionDir: string;
  if (match && match[1] && match[2] && match[3]) {
    sessionDir = join(sessionsDir, match[1], match[2], match[3], sessionId);
  } else {
    sessionDir = join(sessionsDir, sessionId);
  }
  mkdirSync(sessionDir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    const filePath = join(sessionDir, name);
    const dir = filePath.substring(0, filePath.lastIndexOf("/"));
    mkdirSync(dir, { recursive: true });
    writeFileSync(filePath, content);
  }
}

describe("handleApiRequest", () => {
  test("returns null for non-matching paths", async () => {
    const ctx = makeCtx(makeTempDir());
    const { request, url } = makeRequest("/api/unknown");
    const resp = await handleApiRequest(request, url, ctx);
    expect(resp).toBeNull();
  });

  describe("GET /api/sessions", () => {
    test("returns empty list when no sessions", async () => {
      const ctx = makeCtx(makeTempDir());
      const { request, url } = makeRequest("/api/sessions");
      const resp = await handleApiRequest(request, url, ctx);
      expect(resp).not.toBeNull();
      expect(resp!.status).toBe(200);
      const body = await resp!.json() as { sessions: unknown[] };
      expect(body.sessions).toEqual([]);
    });

    test("returns sessions list", async () => {
      const dir = makeTempDir();
      const sessionId = "2026-06-18T14-00-00-000Z-abcd1234";
      createSession(dir, sessionId, {
        "metadata.json": JSON.stringify({ createdAt: "2026-06-18T14:00:00Z", status: "completed" }),
        "transcript.jsonl": '{"type":"user"}\n',
      });

      const ctx = makeCtx(dir);
      const { request, url } = makeRequest("/api/sessions");
      const resp = await handleApiRequest(request, url, ctx);
      const body = await resp!.json() as { sessions: { id: string; status: string }[] };
      expect(body.sessions.length).toBe(1);
      const first = body.sessions[0]!;
      expect(first.id).toBe(sessionId);
      expect(first.status).toBe("completed");
    });
  });

  describe("GET /api/sessions/{id}", () => {
    test("returns 404 for non-existent session", async () => {
      const ctx = makeCtx(makeTempDir());
      const { request, url } = makeRequest("/api/sessions/2026-06-18T00-00-00-000Z-nonexist");
      const resp = await handleApiRequest(request, url, ctx);
      expect(resp!.status).toBe(404);
    });

    test("returns session metadata", async () => {
      const dir = makeTempDir();
      const sessionId = "2026-06-18T14-00-00-000Z-abcd1234";
      createSession(dir, sessionId, {
        "metadata.json": JSON.stringify({ createdAt: "2026-06-18T14:00:00Z", status: "completed" }),
      });

      const ctx = makeCtx(dir);
      const { request, url } = makeRequest(`/api/sessions/${sessionId}`);
      const resp = await handleApiRequest(request, url, ctx);
      expect(resp!.status).toBe(200);
      const body = await resp!.json() as { id: string };
      expect(body.id).toBe(sessionId);
    });

    test("returns 400 for invalid session id with path traversal", async () => {
      const ctx = makeCtx(makeTempDir());
      const { request, url } = makeRequest("/api/sessions/..%2F..%2Fetc%2Fpasswd");
      const resp = await handleApiRequest(request, url, ctx);
      expect(resp!.status).toBe(400);
    });
  });

  describe("GET /api/sessions/{id}/report", () => {
    test("returns report.md content", async () => {
      const dir = makeTempDir();
      const sessionId = "2026-06-18T14-00-00-000Z-abcd1234";
      createSession(dir, sessionId, { "report.md": "# Test Report" });

      const ctx = makeCtx(dir);
      const { request, url } = makeRequest(`/api/sessions/${sessionId}/report`);
      const resp = await handleApiRequest(request, url, ctx);
      expect(resp!.status).toBe(200);
      expect(resp!.headers.get("content-type")).toContain("text/markdown");
      expect(await resp!.text()).toBe("# Test Report");
    });

    test("falls back to output.md", async () => {
      const dir = makeTempDir();
      const sessionId = "2026-06-18T14-00-00-000Z-abcd1234";
      createSession(dir, sessionId, { "output.md": "# Output" });

      const ctx = makeCtx(dir);
      const { request, url } = makeRequest(`/api/sessions/${sessionId}/report`);
      const resp = await handleApiRequest(request, url, ctx);
      expect(resp!.status).toBe(200);
      expect(await resp!.text()).toBe("# Output");
    });

    test("returns 404 when no report", async () => {
      const dir = makeTempDir();
      const sessionId = "2026-06-18T14-00-00-000Z-abcd1234";
      createSession(dir, sessionId, { "transcript.jsonl": "{}\n" });

      const ctx = makeCtx(dir);
      const { request, url } = makeRequest(`/api/sessions/${sessionId}/report`);
      const resp = await handleApiRequest(request, url, ctx);
      expect(resp!.status).toBe(404);
    });
  });

  describe("GET /api/sessions/{id}/artifacts", () => {
    test("returns artifact list", async () => {
      const dir = makeTempDir();
      const sessionId = "2026-06-18T14-00-00-000Z-abcd1234";
      createSession(dir, sessionId, {
        "artifacts/data.csv": "a,b,c",
        "artifacts/graph.png": "fake-png",
      });

      const ctx = makeCtx(dir);
      const { request, url } = makeRequest(`/api/sessions/${sessionId}/artifacts`);
      const resp = await handleApiRequest(request, url, ctx);
      expect(resp!.status).toBe(200);
      const body = await resp!.json() as string[];
      expect(body.sort()).toEqual(["data.csv", "graph.png"]);
    });

    test("returns empty list when no artifacts", async () => {
      const dir = makeTempDir();
      const sessionId = "2026-06-18T14-00-00-000Z-abcd1234";
      createSession(dir, sessionId, { "transcript.jsonl": "{}\n" });

      const ctx = makeCtx(dir);
      const { request, url } = makeRequest(`/api/sessions/${sessionId}/artifacts`);
      const resp = await handleApiRequest(request, url, ctx);
      const body = await resp!.json() as string[];
      expect(body).toEqual([]);
    });
  });

  describe("GET /api/sessions/{id}/transcript", () => {
    test("returns parsed transcript events", async () => {
      const dir = makeTempDir();
      const sessionId = "2026-06-18T14-00-00-000Z-abcd1234";
      createSession(dir, sessionId, {
        "transcript.jsonl": '{"type":"user","content":"hello"}\n{"type":"assistant","content":"hi"}\n',
      });

      const ctx = makeCtx(dir);
      const { request, url } = makeRequest(`/api/sessions/${sessionId}/transcript`);
      const resp = await handleApiRequest(request, url, ctx);
      expect(resp!.status).toBe(200);
      const body = await resp!.json() as { type: string }[];
      expect(body.length).toBe(2);
      expect(body[0]!.type).toBe("user");
    });
  });

  describe("GET /api/sessions/{id}/export", () => {
    test("returns ZIP file", async () => {
      const dir = makeTempDir();
      const sessionId = "2026-06-18T14-00-00-000Z-abcd1234";
      createSession(dir, sessionId, {
        "transcript.jsonl": '{"type":"user"}\n',
        "report.md": "# Report",
      });

      const ctx = makeCtx(dir);
      const { request, url } = makeRequest(`/api/sessions/${sessionId}/export`);
      const resp = await handleApiRequest(request, url, ctx);
      expect(resp!.status).toBe(200);
      expect(resp!.headers.get("content-type")).toBe("application/zip");
      expect(resp!.headers.get("content-disposition")).toContain(sessionId);
    });

    test("returns 404 for non-existent session", async () => {
      const ctx = makeCtx(makeTempDir());
      const { request, url } = makeRequest("/api/sessions/2026-06-18T00-00-00-000Z-nonexist/export");
      const resp = await handleApiRequest(request, url, ctx);
      expect(resp!.status).toBe(404);
    });
  });

  describe("POST /api/sessions/{id}/export-url", () => {
    test("returns export URL with token", async () => {
      const dir = makeTempDir();
      const sessionId = "2026-06-18T14-00-00-000Z-abcd1234";
      createSession(dir, sessionId, {
        "metadata.json": JSON.stringify({ createdAt: "2026-06-18T14:00:00Z", status: "completed" }),
      });

      const ctx = makeCtx(dir);
      const url = new URL(`http://localhost:8080/api/sessions/${sessionId}/export-url`);
      const request = new Request(url.toString(), { method: "POST" });
      const resp = await handleApiRequest(request, url, ctx);
      expect(resp).not.toBeNull();
      expect(resp!.status).toBe(200);
      const body = await resp!.json() as { url: string; expiresAt: string };
      expect(body.url).toContain("/export/");
      expect(body.expiresAt).toBeTruthy();
    });

    test("returns 404 for non-existent session", async () => {
      const ctx = makeCtx(makeTempDir());
      const url = new URL("http://localhost:8080/api/sessions/2026-06-18T00-00-00-000Z-nonexist/export-url");
      const request = new Request(url.toString(), { method: "POST" });
      const resp = await handleApiRequest(request, url, ctx);
      expect(resp!.status).toBe(404);
    });

    test("only responds to POST", async () => {
      const ctx = makeCtx(makeTempDir());
      const url = new URL("http://localhost:8080/api/sessions/2026-06-18T00-00-00-000Z-test/export-url");
      const request = new Request(url.toString(), { method: "GET" });
      const resp = await handleApiRequest(request, url, ctx);
      expect(resp).toBeNull();
    });
  });
});
