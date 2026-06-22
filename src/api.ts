import type { SessionStorage } from "./storage.js";
import type { Logger } from "./logger.js";
import { generateExportToken } from "./export-token.js";

export interface ApiContext {
  storage: SessionStorage;
  logger: Logger;
  exportSecret: Uint8Array;
  baseUrl: string;
}

/**
 * Handles API requests under /api/*.
 * Returns a Response if the route matches, or null to fall through.
 */
export async function handleApiRequest(
  _request: Request,
  url: URL,
  ctx: ApiContext,
): Promise<Response | null> {
  const path = url.pathname;

  const sessionsMatch = path.match(/^\/api\/sessions\/?$/);
  if (sessionsMatch) {
    return handleListSessions(url, ctx);
  }

  const sessionDetailMatch = path.match(/^\/api\/sessions\/([^/]+)$/);
  if (sessionDetailMatch && sessionDetailMatch[1]) {
    return handleGetSession(sessionDetailMatch[1], ctx);
  }

  const reportMatch = path.match(/^\/api\/sessions\/([^/]+)\/report$/);
  if (reportMatch && reportMatch[1]) {
    return handleGetReport(reportMatch[1], ctx);
  }

  const artifactsListMatch = path.match(/^\/api\/sessions\/([^/]+)\/artifacts\/?$/);
  if (artifactsListMatch && artifactsListMatch[1]) {
    return handleListArtifacts(artifactsListMatch[1], ctx);
  }

  const artifactMatch = path.match(/^\/api\/sessions\/([^/]+)\/artifacts\/(.+)$/);
  if (artifactMatch && artifactMatch[1] && artifactMatch[2]) {
    let decodedName: string;
    try {
      decodedName = decodeURIComponent(artifactMatch[2]);
    } catch {
      return errorResponse("invalid artifact path", 400);
    }
    return handleGetArtifact(artifactMatch[1], decodedName, ctx);
  }

  const transcriptMatch = path.match(/^\/api\/sessions\/([^/]+)\/transcript$/);
  if (transcriptMatch && transcriptMatch[1]) {
    return handleGetTranscript(transcriptMatch[1], ctx);
  }

  const runbooksListMatch = path.match(/^\/api\/sessions\/([^/]+)\/runbooks\/?$/);
  if (runbooksListMatch && runbooksListMatch[1]) {
    return handleListRunbooks(runbooksListMatch[1], ctx);
  }

  const runbookReportMatch = path.match(/^\/api\/sessions\/([^/]+)\/runbooks\/([^/]+)\/([^/]+)\/report$/);
  if (runbookReportMatch && runbookReportMatch[1] && runbookReportMatch[2] && runbookReportMatch[3]) {
    let runbookId: string;
    let toolUseId: string;
    try {
      runbookId = decodeURIComponent(runbookReportMatch[2]);
      toolUseId = decodeURIComponent(runbookReportMatch[3]);
    } catch {
      return errorResponse("invalid runbook path", 400);
    }
    return handleGetRunbookReport(runbookReportMatch[1], runbookId, toolUseId, ctx);
  }

  const exportMatch = path.match(/^\/api\/sessions\/([^/]+)\/export$/);
  if (exportMatch && exportMatch[1]) {
    return handleExport(exportMatch[1], ctx);
  }

  const exportUrlMatch = path.match(/^\/api\/sessions\/([^/]+)\/export-url$/);
  if (exportUrlMatch && exportUrlMatch[1] && _request.method === "POST") {
    return handleCreateExportUrl(exportUrlMatch[1], ctx);
  }

  return null;
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function errorResponse(message: string, status: number): Response {
  return jsonResponse({ error: message }, status);
}

function validateSessionId(id: string): boolean {
  return /^[\w.-]+$/.test(id) && !id.includes("..");
}

function validateArtifactPath(name: string): boolean {
  if (!name || name.includes("..") || name.startsWith("/") || name.startsWith("\\")) return false;
  return true;
}

async function handleListSessions(url: URL, ctx: ApiContext): Promise<Response> {
  const rawLimit = parseInt(url.searchParams.get("limit") ?? "50", 10);
  const limit = Number.isNaN(rawLimit) ? 50 : Math.min(Math.max(rawLimit, 1), 200);
  const cursor = url.searchParams.get("cursor") ?? null;

  try {
    const listOpts = cursor ? { limit, cursor } : { limit };
    const result = await ctx.storage.listSessions(listOpts);
    return jsonResponse(result);
  } catch (e) {
    ctx.logger.error("listSessions failed", { error: e instanceof Error ? e.message : String(e) });
    return errorResponse("internal server error", 500);
  }
}

async function handleGetSession(id: string, ctx: ApiContext): Promise<Response> {
  if (!validateSessionId(id)) return errorResponse("invalid session id", 400);
  try {
    const session = await ctx.storage.getSession(id);
    if (!session) return errorResponse("session not found", 404);
    return jsonResponse(session);
  } catch (e) {
    ctx.logger.error("getSession failed", { error: e instanceof Error ? e.message : String(e) });
    return errorResponse("internal server error", 500);
  }
}

async function handleGetReport(id: string, ctx: ApiContext): Promise<Response> {
  if (!validateSessionId(id)) return errorResponse("invalid session id", 400);
  try {
    const content = await ctx.storage.readReport(id);
    if (!content) return errorResponse("report not found", 404);
    return new Response(content, { headers: { "Content-Type": "text/markdown; charset=utf-8" } });
  } catch (e) {
    ctx.logger.error("readReport failed", { error: e instanceof Error ? e.message : String(e) });
    return errorResponse("internal server error", 500);
  }
}

async function handleListRunbooks(id: string, ctx: ApiContext): Promise<Response> {
  if (!validateSessionId(id)) return errorResponse("invalid session id", 400);
  try {
    const entries = await ctx.storage.listRunbooks(id);
    return jsonResponse(entries);
  } catch (e) {
    ctx.logger.error("listRunbooks failed", { error: e instanceof Error ? e.message : String(e) });
    return errorResponse("internal server error", 500);
  }
}

async function handleGetRunbookReport(id: string, runbookId: string, toolUseId: string, ctx: ApiContext): Promise<Response> {
  if (!validateSessionId(id)) return errorResponse("invalid session id", 400);
  if (!validateArtifactPath(runbookId) || !validateArtifactPath(toolUseId)) return errorResponse("invalid runbook path", 400);
  try {
    const content = await ctx.storage.readRunbookReport(id, runbookId, toolUseId);
    if (!content) return errorResponse("runbook report not found", 404);
    return new Response(content, { headers: { "Content-Type": "text/markdown; charset=utf-8" } });
  } catch (e) {
    ctx.logger.error("readRunbookReport failed", { error: e instanceof Error ? e.message : String(e) });
    return errorResponse("internal server error", 500);
  }
}

async function handleListArtifacts(id: string, ctx: ApiContext): Promise<Response> {
  if (!validateSessionId(id)) return errorResponse("invalid session id", 400);
  try {
    const names = await ctx.storage.listArtifacts(id);
    return jsonResponse(names);
  } catch (e) {
    ctx.logger.error("listArtifacts failed", { error: e instanceof Error ? e.message : String(e) });
    return errorResponse("internal server error", 500);
  }
}

async function handleGetArtifact(id: string, name: string, ctx: ApiContext): Promise<Response> {
  if (!validateSessionId(id)) return errorResponse("invalid session id", 400);
  if (!validateArtifactPath(name)) return errorResponse("invalid artifact name", 400);
  try {
    const content = await ctx.storage.readArtifact(id, name);
    if (!content) return errorResponse("artifact not found", 404);
    return new Response(content, { headers: { "Content-Type": inferMimeType(name) } });
  } catch (e) {
    ctx.logger.error("readArtifact failed", { error: e instanceof Error ? e.message : String(e) });
    return errorResponse("internal server error", 500);
  }
}

async function handleGetTranscript(id: string, ctx: ApiContext): Promise<Response> {
  if (!validateSessionId(id)) return errorResponse("invalid session id", 400);
  try {
    const events = await ctx.storage.readTranscript(id);
    return jsonResponse(events);
  } catch (e) {
    ctx.logger.error("readTranscript failed", { error: e instanceof Error ? e.message : String(e) });
    return errorResponse("internal server error", 500);
  }
}

async function handleExport(id: string, ctx: ApiContext): Promise<Response> {
  if (!validateSessionId(id)) return errorResponse("invalid session id", 400);
  try {
    const session = await ctx.storage.getSession(id);
    if (!session) return errorResponse("session not found", 404);

    const result = await ctx.storage.getExportUrl(id);
    if (result.type === "redirect" && result.url) {
      return Response.redirect(result.url, 302);
    }
    const zip = await ctx.storage.exportAsZip(id);
    return new Response(zip, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${id}.zip"`,
      },
    });
  } catch (e) {
    ctx.logger.error("export failed", { error: e instanceof Error ? e.message : String(e) });
    return errorResponse("internal server error", 500);
  }
}

const MIME_MAP: Record<string, string> = {
  ".md": "text/markdown",
  ".json": "application/json",
  ".jsonl": "application/x-ndjson",
  ".txt": "text/plain",
  ".csv": "text/csv",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".html": "text/html",
  ".pdf": "application/pdf",
};

function inferMimeType(name: string): string {
  const ext = name.slice(name.lastIndexOf(".")).toLowerCase();
  return MIME_MAP[ext] ?? "application/octet-stream";
}

const EXPORT_TOKEN_EXPIRES_IN = "15m";
const EXPORT_TOKEN_EXPIRES_MS = 15 * 60 * 1000;

async function handleCreateExportUrl(id: string, ctx: ApiContext): Promise<Response> {
  if (!validateSessionId(id)) return errorResponse("invalid session id", 400);
  try {
    const session = await ctx.storage.getSession(id);
    if (!session) return errorResponse("session not found", 404);

    const token = await generateExportToken(id, ctx.exportSecret, EXPORT_TOKEN_EXPIRES_IN);
    const url = `${ctx.baseUrl}/export/${token}`;
    const expiresAt = new Date(Date.now() + EXPORT_TOKEN_EXPIRES_MS).toISOString();
    return jsonResponse({ url, expiresAt });
  } catch (e) {
    ctx.logger.error("createExportUrl failed", { error: e instanceof Error ? e.message : String(e) });
    return errorResponse("internal server error", 500);
  }
}
