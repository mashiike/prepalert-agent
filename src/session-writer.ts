import { mkdirSync, appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { join, basename } from "node:path";
import { MAX_BUFFER_LINES } from "./transcript.js";
import type { TranscriptEvent, TranscriptWriter } from "./transcript.js";
import type { SessionStorage, SessionMetadata } from "./storage.js";
import { createSessionDir } from "./storage.js";
import type { Logger } from "./logger.js";

export interface SessionWriterOptions {
  flushThreshold?: number;
  logger?: Logger;
}

/**
 * Manages writes for a single session.
 *
 * Transcript events are buffered locally and uploaded to storage on finalize().
 * Report, artifact, and metadata writes go to both local and storage immediately.
 * Implements TranscriptWriter for backward compatibility with execute.ts.
 */
export class SessionWriter implements TranscriptWriter {
  readonly sessionId: string;
  readonly sessionDir: string;
  private readonly storage: SessionStorage | null;
  private buffer: string[] = [];
  private readonly flushThreshold: number;
  private readonly logger: Logger | undefined;
  private closed = false;
  private readonly transcriptPath: string;

  constructor(sessionsDir: string, storage: SessionStorage | null, opts?: SessionWriterOptions) {
    const { sessionId, sessionDir } = createSessionDir(sessionsDir);
    this.sessionId = sessionId;
    this.sessionDir = sessionDir;
    mkdirSync(this.sessionDir, { recursive: true });

    this.transcriptPath = join(this.sessionDir, "transcript.jsonl");
    this.storage = storage;
    this.flushThreshold = opts?.flushThreshold ?? 10;
    this.logger = opts?.logger;
  }

  /** TranscriptWriter.write — buffers transcript events locally. */
  write(event: TranscriptEvent): void {
    this.writeTranscriptEvent(event);
  }

  writeTranscriptEvent(event: TranscriptEvent): void {
    if (this.closed) return;
    this.buffer.push(JSON.stringify(event));
    if (this.buffer.length >= this.flushThreshold) {
      this.flushBuffer();
    }
  }

  async writeReport(content: string): Promise<void> {
    const localPath = join(this.sessionDir, "report.md");
    writeFileSync(localPath, content);
    if (this.storage) {
      await this.storage.writeReport(this.sessionId, content);
    }
  }

  async writeArtifact(name: string, content: Uint8Array): Promise<void> {
    const safeName = validateArtifactName(name);
    validateArtifactSize(content);
    const artifactsDir = join(this.sessionDir, "artifacts");
    mkdirSync(artifactsDir, { recursive: true });
    const localPath = join(artifactsDir, safeName);
    writeFileSync(localPath, content);
    if (this.storage) {
      await this.storage.writeArtifact(this.sessionId, safeName, content);
    }
  }

  async writeMetadata(metadata: Omit<SessionMetadata, "id">): Promise<void> {
    const localPath = join(this.sessionDir, "metadata.json");
    writeFileSync(localPath, JSON.stringify(metadata));
    if (this.storage) {
      await this.storage.writeMetadata(this.sessionId, metadata);
    }
  }

  /**
   * Saves a runbook agent's result as a report.
   * Path: runbooks/{sanitizedRunbookId}/{toolUseId}/report.md
   * Runbook IDs may contain "/" (e.g. "web-api/5xx-rate-over-limit"),
   * which is replaced with "--" to keep a flat directory structure.
   */
  async writeRunbookReport(runbookId: string, toolUseId: string, content: string): Promise<void> {
    const safeRunbookId = runbookId.replace(/\//g, "--");
    const safeToolUseId = validateArtifactName(toolUseId);
    const reportDir = join(this.sessionDir, "runbooks", safeRunbookId, safeToolUseId);
    mkdirSync(reportDir, { recursive: true });
    const localPath = join(reportDir, "report.md");
    writeFileSync(localPath, content);
    if (this.storage) {
      await this.storage.writeRunbookReport(this.sessionId, safeRunbookId, safeToolUseId, new TextEncoder().encode(content));
    }
  }

  /** TranscriptWriter.close — flushes buffer and uploads transcript to storage. */
  async close(): Promise<void> {
    await this.finalize();
  }

  async finalize(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.flushBuffer();

    if (this.storage) {
      try {
        const content = readFileSync(this.transcriptPath);
        await this.storage.writeTranscript(this.sessionId, new Uint8Array(content));
      } catch (e) {
        if (e instanceof Error && "code" in e && (e as NodeJS.ErrnoException).code === "ENOENT") {
          return;
        }
        const msg = e instanceof Error ? e.message : String(e);
        this.logger?.warn("failed to upload transcript to storage", { sessionId: this.sessionId, error: msg });
      }
    }
  }

  private flushBuffer(): void {
    if (this.buffer.length === 0) return;
    const lines = this.buffer;
    this.buffer = [];
    try {
      appendFileSync(this.transcriptPath, lines.join("\n") + "\n");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger?.warn("transcript write failed", { path: this.transcriptPath, error: msg });
      this.buffer = [...lines, ...this.buffer];
      if (this.buffer.length > MAX_BUFFER_LINES) {
        const dropped = this.buffer.length - MAX_BUFFER_LINES;
        this.buffer = this.buffer.slice(dropped);
        this.logger?.warn("transcript buffer overflow, dropping oldest events", {
          path: this.transcriptPath,
          dropped,
        });
      }
    }
  }
}

export const MAX_ARTIFACT_SIZE = 10 * 1024 * 1024;

export function validateArtifactName(name: string): string {
  const safe = basename(name);
  if (!safe || safe === "." || safe === ".." || safe.startsWith(".")) {
    throw new Error(`invalid artifact name: ${name}`);
  }
  return safe;
}

export function validateArtifactSize(content: Uint8Array): void {
  if (content.byteLength > MAX_ARTIFACT_SIZE) {
    throw new Error(`artifact too large: ${content.byteLength} bytes (max ${MAX_ARTIFACT_SIZE})`);
  }
}
