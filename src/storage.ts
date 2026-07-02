import { readFile, readdir, stat, writeFile, mkdir } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
  PutObjectCommand,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { zipSync } from "fflate";
import type { Logger } from "./logger.js";

export interface SessionMetadata {
  id: string;
  createdAt: string;
  status: "running" | "completed" | "error";
}

export interface ExportUrlResult {
  type: "redirect" | "direct";
  url?: string | undefined;
}

export interface ListSessionsResult {
  sessions: SessionMetadata[];
  nextCursor?: string | undefined;
}

export interface RunbookEntry {
  runbookId: string;
  toolUseId: string;
}

export interface StorageOptions {
  endpoint?: string | undefined;
  forcePathStyle?: boolean | undefined;
  region?: string | undefined;
}

export interface SessionStorage {
  listSessions(opts?: { limit?: number; cursor?: string }): Promise<ListSessionsResult>;
  getSession(id: string): Promise<SessionMetadata | null>;
  readReport(id: string): Promise<string | null>;
  listArtifacts(id: string): Promise<string[]>;
  readArtifact(id: string, name: string): Promise<Uint8Array | null>;
  listRunbooks(id: string): Promise<RunbookEntry[]>;
  readRunbookReport(id: string, runbookId: string, toolUseId: string): Promise<string | null>;
  readTranscript(id: string): Promise<unknown[]>;
  getExportUrl(id: string, expiresInSec?: number): Promise<ExportUrlResult>;
  exportAsZip(id: string): Promise<Uint8Array>;

  writeMetadata(id: string, metadata: Omit<SessionMetadata, "id">): Promise<void>;
  writeReport(id: string, content: string): Promise<void>;
  writeArtifact(id: string, name: string, content: Uint8Array): Promise<void>;
  writeRunbookReport(id: string, runbookId: string, toolUseId: string, content: Uint8Array): Promise<void>;
  writeTranscript(id: string, content: Uint8Array): Promise<void>;
}

/**
 * Extracts YYYY/MM/DD date partition from a session ID.
 * Session IDs start with ISO timestamps like "2026-06-18T14-32-45-123Z-a1b2c3d4".
 */
export function sessionIdToDatePartition(sessionId: string): string {
  const match = sessionId.match(/^(\d{4})-(\d{2})-(\d{2})T/);
  if (!match) {
    throw new Error(`cannot extract date partition from session ID: ${sessionId}`);
  }
  return `${match[1]}/${match[2]}/${match[3]}`;
}

export interface SessionDir {
  sessionId: string;
  sessionDir: string;
}

/**
 * Generates a new session ID and resolves the session directory path.
 * All session directory creation should go through this function to ensure
 * consistent directory structure (date-partitioned: YYYY/MM/DD/{session-id}/).
 */
export function createSessionDir(sessionsDir: string): SessionDir {
  const now = new Date();
  const ts = now.toISOString().replace(/[:.]/g, "-");
  const id = crypto.randomUUID().slice(0, 8);
  const sessionId = `${ts}-${id}`;
  const partition = sessionIdToDatePartition(sessionId);
  const sessionDir = join(sessionsDir, partition, sessionId);
  return { sessionId, sessionDir };
}

function parseStorageUrl(url: string): { bucket: string; prefix: string; scheme: "s3" | "gs" } {
  const match = url.match(/^(s3|gs):\/\/([^/]+)\/?(.*)$/);
  if (!match || !match[1] || !match[2]) {
    throw new Error(`invalid storage URL: ${url} (expected s3://bucket/prefix or gs://bucket/prefix)`);
  }
  const scheme = match[1] as "s3" | "gs";
  const bucket = match[2];
  let prefix = match[3] ?? "";
  if (prefix && !prefix.endsWith("/")) {
    prefix += "/";
  }
  return { bucket, prefix, scheme };
}

/**
 * Creates a SessionStorage from a storage URL, or returns null if not configured.
 */
export function createSessionStorage(
  storageUrl: string | undefined,
  storageOptions?: StorageOptions,
  logger?: Logger,
): SessionStorage | null {
  if (!storageUrl) return null;

  const { bucket, prefix, scheme } = parseStorageUrl(storageUrl);

  const clientConfig: S3ClientConfig = {};
  if (storageOptions?.region) {
    clientConfig.region = storageOptions.region;
  }
  if (scheme === "gs") {
    clientConfig.endpoint = storageOptions?.endpoint ?? "https://storage.googleapis.com";
    clientConfig.forcePathStyle = storageOptions?.forcePathStyle ?? true;
  } else {
    if (storageOptions?.endpoint) {
      clientConfig.endpoint = storageOptions.endpoint;
    }
    if (storageOptions?.forcePathStyle !== undefined) {
      clientConfig.forcePathStyle = storageOptions.forcePathStyle;
    }
  }

  const client = new S3Client(clientConfig);
  return new S3SessionStorage(client, bucket, prefix, logger);
}

const DEFAULT_LIST_LIMIT = 50;
const DEFAULT_EXPORT_EXPIRES = 900;

class S3SessionStorage implements SessionStorage {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly prefix: string;
  private readonly logger: Logger | undefined;

  constructor(client: S3Client, bucket: string, prefix: string, logger?: Logger) {
    this.client = client;
    this.bucket = bucket;
    this.prefix = prefix;
    this.logger = logger;
  }

  private sessionKey(sessionId: string, file: string): string {
    const partition = sessionIdToDatePartition(sessionId);
    return `${this.prefix}${partition}/${sessionId}/${file}`;
  }

  /**
   * Lists sessions newest-first.
   * Collects all metadata.json keys via ListObjectsV2, extracts session IDs,
   * sorts descending, and paginates with cursor (= last session ID seen).
   * Works for up to ~1000 sessions per API call; sufficient for typical scale.
   */
  async listSessions(opts?: { limit?: number; cursor?: string }): Promise<ListSessionsResult> {
    const limit = opts?.limit ?? DEFAULT_LIST_LIMIT;

    const allSessionIds = await this.collectAllSessionIds();
    allSessionIds.sort((a, b) => b.localeCompare(a));

    let filtered = allSessionIds;
    if (opts?.cursor) {
      const cursor = opts.cursor;
      const idx = filtered.findIndex(id => id < cursor);
      filtered = idx >= 0 ? filtered.slice(idx) : [];
    }

    const page = filtered.slice(0, limit);
    const sessions: SessionMetadata[] = [];
    for (const id of page) {
      const meta = await this.getSession(id);
      if (meta) sessions.push(meta);
    }

    const result: ListSessionsResult = { sessions };
    if (page.length === limit && filtered.length > limit) {
      const last = page[page.length - 1];
      if (last) result.nextCursor = last;
    }
    return result;
  }

  private async listAllKeys(prefix: string): Promise<string[]> {
    const keys: string[] = [];
    let continuationToken: string | undefined;

    do {
      const command = new ListObjectsV2Command({
        Bucket: this.bucket,
        Prefix: prefix,
        ...(continuationToken ? { ContinuationToken: continuationToken } : {}),
      });
      const response = await this.client.send(command);
      for (const obj of response.Contents ?? []) {
        if (obj.Key) keys.push(obj.Key);
      }
      continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
    } while (continuationToken);

    return keys;
  }

  /**
   * Lists all session IDs by finding metadata.json files under the prefix.
   * Uses S3 ListObjectsV2 with suffix filtering on key names.
   */
  private async collectAllSessionIds(): Promise<string[]> {
    const ids: string[] = [];
    for (const key of await this.listAllKeys(this.prefix)) {
      if (!key.endsWith("/metadata.json")) continue;
      const relative = key.slice(this.prefix.length);
      const parts = relative.split("/");
      const sessionId = parts[parts.length - 2];
      if (sessionId) ids.push(sessionId);
    }
    return ids;
  }

  async getSession(id: string): Promise<SessionMetadata | null> {
    const body = await this.getObject(this.sessionKey(id, "metadata.json"));
    if (body) {
      try {
        const text = new TextDecoder().decode(body);
        const parsed = JSON.parse(text) as { createdAt?: string; status?: string };
        if (parsed.createdAt && parsed.status) {
          return {
            id,
            createdAt: parsed.createdAt,
            status: parsed.status as SessionMetadata["status"],
          };
        }
      } catch {}
    }
    const partition = sessionIdToDatePartition(id);
    const listCmd = new ListObjectsV2Command({
      Bucket: this.bucket,
      Prefix: `${this.prefix}${partition}/${id}/`,
      MaxKeys: 1,
    });
    try {
      const resp = await this.client.send(listCmd);
      if (resp.Contents && resp.Contents.length > 0) {
        return {
          id,
          createdAt: deriveCreatedAtFromSessionId(id),
          status: "completed",
        };
      }
    } catch (e: unknown) {
      this.logger?.warn("failed to list session objects", {
        sessionId: id,
        error: e instanceof Error ? e.message : String(e),
      });
      return null;
    }
    return null;
  }

  async readReport(id: string): Promise<string | null> {
    const body = await this.getObject(this.sessionKey(id, "report.md"));
    if (body) return new TextDecoder().decode(body);
    const fallback = await this.getObject(this.sessionKey(id, "output.md"));
    if (fallback) return new TextDecoder().decode(fallback);
    return null;
  }

  async listArtifacts(id: string): Promise<string[]> {
    const artifactsPrefix = this.sessionKey(id, "artifacts/");
    try {
      const names: string[] = [];
      for (const key of await this.listAllKeys(artifactsPrefix)) {
        const name = key.slice(artifactsPrefix.length);
        if (name) names.push(name);
      }
      return names;
    } catch {
      return [];
    }
  }

  async readArtifact(id: string, name: string): Promise<Uint8Array | null> {
    if (name.includes("..") || name.startsWith("/") || name.startsWith("\\")) return null;
    return this.getObject(this.sessionKey(id, `artifacts/${name}`));
  }

  async listRunbooks(id: string): Promise<RunbookEntry[]> {
    const prefix = this.sessionKey(id, "runbooks/");
    try {
      const entries: RunbookEntry[] = [];
      const seen = new Set<string>();
      for (const key of await this.listAllKeys(prefix)) {
        const rel = key.slice(prefix.length);
        const match = rel.match(/^([^/]+)\/([^/]+)\/report\.md$/);
        if (match && match[1] && match[2]) {
          const key = `${match[1]}/${match[2]}`;
          if (!seen.has(key)) {
            seen.add(key);
            entries.push({ runbookId: match[1], toolUseId: match[2] });
          }
        }
      }
      return entries;
    } catch {
      return [];
    }
  }

  async readRunbookReport(id: string, runbookId: string, toolUseId: string): Promise<string | null> {
    if (runbookId.includes("..") || toolUseId.includes("..")) return null;
    const data = await this.getObject(this.sessionKey(id, `runbooks/${runbookId}/${toolUseId}/report.md`));
    if (!data) return null;
    return new TextDecoder().decode(data);
  }

  async readTranscript(id: string): Promise<unknown[]> {
    const body = await this.getObject(this.sessionKey(id, "transcript.jsonl"));
    if (!body) return [];
    const text = new TextDecoder().decode(body);
    const events: unknown[] = [];
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        events.push(JSON.parse(trimmed));
      } catch {
        this.logger?.warn("failed to parse transcript line", { sessionId: id });
      }
    }
    return events;
  }

  async getExportUrl(id: string, expiresInSec?: number): Promise<ExportUrlResult> {
    const partition = sessionIdToDatePartition(id);
    const zipKey = `${this.prefix}${partition}/${id}/export.zip`;

    const zip = await this.exportAsZip(id);
    await this.client.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: zipKey,
      Body: zip,
      ContentType: "application/zip",
    }));

    const url = await getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.bucket, Key: zipKey }),
      { expiresIn: expiresInSec ?? DEFAULT_EXPORT_EXPIRES },
    );

    return { type: "redirect", url };
  }

  async exportAsZip(id: string): Promise<Uint8Array> {
    const partition = sessionIdToDatePartition(id);
    const sessionPrefix = `${this.prefix}${partition}/${id}/`;
    const files: Record<string, Uint8Array> = {};

    for (const key of await this.listAllKeys(sessionPrefix)) {
      const relativePath = key.slice(sessionPrefix.length);
      if (!relativePath || relativePath === "export.zip") continue;
      const body = await this.getObject(key);
      if (body) {
        files[relativePath] = body;
      }
    }

    return zipSync(files);
  }

  async writeMetadata(id: string, metadata: Omit<SessionMetadata, "id">): Promise<void> {
    const body = JSON.stringify(metadata);
    await this.putObject(this.sessionKey(id, "metadata.json"), new TextEncoder().encode(body), "application/json");
  }

  async writeReport(id: string, content: string): Promise<void> {
    await this.putObject(this.sessionKey(id, "report.md"), new TextEncoder().encode(content), "text/markdown");
  }

  async writeArtifact(id: string, name: string, content: Uint8Array): Promise<void> {
    if (name.includes("..") || name.startsWith("/") || name.startsWith("\\")) {
      throw new Error(`invalid artifact name: ${name}`);
    }
    await this.putObject(this.sessionKey(id, `artifacts/${name}`), content);
  }

  async writeRunbookReport(id: string, runbookId: string, toolUseId: string, content: Uint8Array): Promise<void> {
    await this.putObject(this.sessionKey(id, `runbooks/${runbookId}/${toolUseId}/report.md`), content, "text/markdown");
  }

  async writeTranscript(id: string, content: Uint8Array): Promise<void> {
    await this.putObject(this.sessionKey(id, "transcript.jsonl"), content, "application/x-ndjson");
  }

  private async getObject(key: string): Promise<Uint8Array | null> {
    try {
      const response = await this.client.send(new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      }));
      if (!response.Body) return null;
      return new Uint8Array(await response.Body.transformToByteArray());
    } catch (e: unknown) {
      const code = (e as { name?: string }).name;
      if (code === "NoSuchKey" || code === "NotFound") return null;
      throw e;
    }
  }

  private async putObject(key: string, body: Uint8Array, contentType?: string): Promise<void> {
    await this.client.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    }));
  }
}

export function deriveCreatedAtFromSessionId(sessionId: string): string {
  const match = sessionId.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})/);
  if (!match) return new Date().toISOString();
  return `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}Z`;
}

export class LocalSessionStorage implements SessionStorage {
  private readonly sessionsDir: string;

  constructor(sessionsDir: string) {
    this.sessionsDir = sessionsDir;
  }

  private resolveSessionDir(id: string): string {
    const partition = sessionIdToDatePartition(id);
    return join(this.sessionsDir, partition, id);
  }

  async listSessions(opts?: { limit?: number; cursor?: string }): Promise<ListSessionsResult> {
    const limit = opts?.limit ?? DEFAULT_LIST_LIMIT;
    const allIds = await this.collectSessionIds();
    allIds.sort((a, b) => b.localeCompare(a));

    let filtered = allIds;
    if (opts?.cursor) {
      const cursor = opts.cursor;
      const idx = filtered.findIndex(id => id < cursor);
      filtered = idx >= 0 ? filtered.slice(idx) : [];
    }

    const page = filtered.slice(0, limit);
    const sessions: SessionMetadata[] = [];
    for (const id of page) {
      const meta = await this.getSession(id);
      if (meta) sessions.push(meta);
    }

    const result: ListSessionsResult = { sessions };
    if (page.length === limit && filtered.length > limit) {
      const last = page[page.length - 1];
      if (last) result.nextCursor = last;
    }
    return result;
  }

  async getSession(id: string): Promise<SessionMetadata | null> {
    const sessionDir = this.resolveSessionDir(id);
    try {
      const metaPath = join(sessionDir, "metadata.json");
      const content = await readFile(metaPath, "utf-8");
      const parsed = JSON.parse(content) as { createdAt?: string; status?: string };
      if (parsed.createdAt && parsed.status) {
        return { id, createdAt: parsed.createdAt, status: parsed.status as SessionMetadata["status"] };
      }
      return { id, createdAt: deriveCreatedAtFromSessionId(id), status: "completed" };
    } catch {
      try {
        await stat(sessionDir);
      } catch {
        const legacyDir = join(this.sessionsDir, id);
        try {
          await stat(legacyDir);
        } catch {
          return null;
        }
        return { id, createdAt: deriveCreatedAtFromSessionId(id), status: "completed" };
      }
      return { id, createdAt: deriveCreatedAtFromSessionId(id), status: "completed" };
    }
  }

  async readReport(id: string): Promise<string | null> {
    const sessionDir = this.resolveSessionDir(id);
    try {
      return await readFile(join(sessionDir, "report.md"), "utf-8");
    } catch {
      try {
        return await readFile(join(sessionDir, "output.md"), "utf-8");
      } catch {
        try {
          return await readFile(join(this.sessionsDir, id, "report.md"), "utf-8");
        } catch {
          try {
            return await readFile(join(this.sessionsDir, id, "output.md"), "utf-8");
          } catch {
            return null;
          }
        }
      }
    }
  }

  async listArtifacts(id: string): Promise<string[]> {
    const sessionDir = this.resolveSessionDir(id);
    try {
      return await readdir(join(sessionDir, "artifacts"));
    } catch {
      try {
        return await readdir(join(this.sessionsDir, id, "artifacts"));
      } catch {
        return [];
      }
    }
  }

  async readArtifact(id: string, name: string): Promise<Uint8Array | null> {
    const sessionDir = this.resolveSessionDir(id);
    const artifactsDir = resolve(join(sessionDir, "artifacts"));
    const filePath = resolve(join(artifactsDir, name));
    if (!filePath.startsWith(artifactsDir + sep)) return null;
    try {
      const buf = await readFile(filePath);
      return new Uint8Array(buf);
    } catch {
      const legacyArtifactsDir = resolve(join(this.sessionsDir, id, "artifacts"));
      const legacyPath = resolve(join(legacyArtifactsDir, name));
      if (!legacyPath.startsWith(legacyArtifactsDir + sep)) return null;
      try {
        const buf = await readFile(legacyPath);
        return new Uint8Array(buf);
      } catch {
        return null;
      }
    }
  }

  async listRunbooks(id: string): Promise<RunbookEntry[]> {
    const sessionDir = this.resolveSessionDir(id);
    const entries: RunbookEntry[] = [];

    const scan = async (dir: string): Promise<void> => {
      let runbookIds: string[];
      try {
        runbookIds = await readdir(join(dir, "runbooks"));
      } catch {
        return;
      }
      for (const runbookId of runbookIds) {
        let toolUseIds: string[];
        try {
          toolUseIds = await readdir(join(dir, "runbooks", runbookId));
        } catch {
          continue;
        }
        for (const toolUseId of toolUseIds) {
          const reportPath = join(dir, "runbooks", runbookId, toolUseId, "report.md");
          try {
            const s = await stat(reportPath);
            if (s.isFile()) {
              entries.push({ runbookId, toolUseId });
            }
          } catch {}
        }
      }
    };

    await scan(sessionDir);
    if (entries.length === 0) {
      await scan(join(this.sessionsDir, id));
    }
    return entries;
  }

  async readRunbookReport(id: string, runbookId: string, toolUseId: string): Promise<string | null> {
    const sessionDir = this.resolveSessionDir(id);
    const reportPath = resolve(join(sessionDir, "runbooks", runbookId, toolUseId, "report.md"));
    const runbooksBase = resolve(join(sessionDir, "runbooks"));
    if (!reportPath.startsWith(runbooksBase + sep)) return null;
    try {
      return await readFile(reportPath, "utf-8");
    } catch {
      const legacyPath = resolve(join(this.sessionsDir, id, "runbooks", runbookId, toolUseId, "report.md"));
      const legacyBase = resolve(join(this.sessionsDir, id, "runbooks"));
      if (!legacyPath.startsWith(legacyBase + sep)) return null;
      try {
        return await readFile(legacyPath, "utf-8");
      } catch {
        return null;
      }
    }
  }

  async readTranscript(id: string): Promise<unknown[]> {
    const sessionDir = this.resolveSessionDir(id);
    let content: string;
    try {
      content = await readFile(join(sessionDir, "transcript.jsonl"), "utf-8");
    } catch {
      try {
        content = await readFile(join(this.sessionsDir, id, "transcript.jsonl"), "utf-8");
      } catch {
        return [];
      }
    }
    const events: unknown[] = [];
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        events.push(JSON.parse(trimmed));
      } catch {}
    }
    return events;
  }

  async getExportUrl(_id: string): Promise<ExportUrlResult> {
    return { type: "direct" };
  }

  async exportAsZip(id: string): Promise<Uint8Array> {
    let sessionDir = this.resolveSessionDir(id);
    try {
      await stat(sessionDir);
    } catch {
      sessionDir = join(this.sessionsDir, id);
      await stat(sessionDir);
    }

    const files: Record<string, Uint8Array> = {};
    await collectFilesRecursive(sessionDir, "", files);
    return zipSync(files);
  }

  async writeMetadata(id: string, metadata: Omit<SessionMetadata, "id">): Promise<void> {
    const sessionDir = this.resolveSessionDir(id);
    await mkdir(sessionDir, { recursive: true });
    await writeFile(join(sessionDir, "metadata.json"), JSON.stringify(metadata));
  }

  async writeReport(id: string, content: string): Promise<void> {
    const sessionDir = this.resolveSessionDir(id);
    await writeFile(join(sessionDir, "report.md"), content);
  }

  async writeArtifact(id: string, name: string, content: Uint8Array): Promise<void> {
    const sessionDir = this.resolveSessionDir(id);
    const artifactsDir = resolve(join(sessionDir, "artifacts"));
    const filePath = resolve(join(artifactsDir, name));
    if (!filePath.startsWith(artifactsDir + sep)) {
      throw new Error(`invalid artifact name: ${name}`);
    }
    await mkdir(artifactsDir, { recursive: true });
    await writeFile(filePath, content);
  }

  async writeRunbookReport(id: string, runbookId: string, toolUseId: string, content: Uint8Array): Promise<void> {
    const sessionDir = this.resolveSessionDir(id);
    const reportDir = join(sessionDir, "runbooks", runbookId, toolUseId);
    await mkdir(reportDir, { recursive: true });
    await writeFile(join(reportDir, "report.md"), content);
  }

  async writeTranscript(id: string, content: Uint8Array): Promise<void> {
    const sessionDir = this.resolveSessionDir(id);
    await writeFile(join(sessionDir, "transcript.jsonl"), content);
  }

  private async collectSessionIds(): Promise<string[]> {
    const ids: string[] = [];
    try {
      const years = await readdir(this.sessionsDir);
      for (const year of years) {
        if (!/^\d{4}$/.test(year)) continue;
        const yearPath = join(this.sessionsDir, year);
        const yearStat = await stat(yearPath);
        if (!yearStat.isDirectory()) continue;

        const months = await readdir(yearPath);
        for (const month of months) {
          if (!/^\d{2}$/.test(month)) continue;
          const monthPath = join(yearPath, month);
          const monthStat = await stat(monthPath);
          if (!monthStat.isDirectory()) continue;

          const days = await readdir(monthPath);
          for (const day of days) {
            if (!/^\d{2}$/.test(day)) continue;
            const dayPath = join(monthPath, day);
            const dayStat = await stat(dayPath);
            if (!dayStat.isDirectory()) continue;

            const sessions = await readdir(dayPath);
            for (const sessionId of sessions) {
              const sessionPath = join(dayPath, sessionId);
              const sessionStat = await stat(sessionPath);
              if (sessionStat.isDirectory()) {
                ids.push(sessionId);
              }
            }
          }
        }
      }
    } catch {}

    try {
      const entries = await readdir(this.sessionsDir);
      for (const entry of entries) {
        if (/^\d{4}$/.test(entry)) continue;
        const entryPath = join(this.sessionsDir, entry);
        const entryStat = await stat(entryPath);
        if (entryStat.isDirectory() && !ids.includes(entry)) {
          ids.push(entry);
        }
      }
    } catch {}

    return ids;
  }
}

async function collectFilesRecursive(dir: string, prefix: string, files: Record<string, Uint8Array>): Promise<void> {
  const entries = await readdir(dir);
  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const s = await stat(fullPath);
    const relativePath = prefix ? `${prefix}/${entry}` : entry;
    if (s.isDirectory()) {
      await collectFilesRecursive(fullPath, relativePath, files);
    } else if (s.isFile()) {
      const content = await readFile(fullPath);
      files[relativePath] = new Uint8Array(content);
    }
  }
}
