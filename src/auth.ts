import { timingSafeEqual } from "node:crypto";
import * as jose from "jose";

export interface AuthNone {
  authType: "none";
}

export interface AuthBasic {
  authType: "basic";
  username: string;
  password: string;
}

export interface AuthOidc {
  authType: "oidc";
  issuer: string;
  audience: string;
  jwksUri?: string | undefined;
}

export type AuthConfig = AuthNone | AuthBasic | AuthOidc;

export type AuthResult =
  | { ok: true }
  | { ok: false; status: number; message: string; headers?: Record<string, string> | undefined };

export async function verifyAuth(
  request: Request,
  config: AuthConfig,
): Promise<AuthResult> {
  switch (config.authType) {
    case "none":
      return { ok: true };
    case "basic":
      return verifyBasicAuth(request, config);
    case "oidc":
      return verifyOidcAuth(request, config);
  }
}

function constantTimeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  const maxLen = Math.max(bufA.length, bufB.length);
  const paddedA = Buffer.alloc(maxLen);
  const paddedB = Buffer.alloc(maxLen);
  bufA.copy(paddedA);
  bufB.copy(paddedB);
  return timingSafeEqual(paddedA, paddedB) && bufA.length === bufB.length;
}

function verifyBasicAuth(request: Request, config: AuthBasic): AuthResult {
  const challenge = { "WWW-Authenticate": 'Basic realm="prepalert"' };
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Basic ")) {
    return { ok: false, status: 401, message: "Missing Basic authentication", headers: challenge };
  }
  let decoded: string;
  try {
    decoded = atob(authHeader.slice(6));
  } catch {
    return { ok: false, status: 401, message: "Invalid Basic authentication", headers: challenge };
  }
  const sep = decoded.indexOf(":");
  if (sep === -1) {
    return { ok: false, status: 401, message: "Invalid Basic authentication", headers: challenge };
  }
  const username = decoded.slice(0, sep);
  const password = decoded.slice(sep + 1);
  const usernameMatch = constantTimeEqual(username, config.username);
  const passwordMatch = constantTimeEqual(password, config.password);
  if (!usernameMatch || !passwordMatch) {
    return { ok: false, status: 401, message: "Invalid credentials", headers: challenge };
  }
  return { ok: true };
}

const jwksCache = new Map<string, ReturnType<typeof jose.createRemoteJWKSet>>();
const jwksUriCache = new Map<string, string>();

async function resolveJwksUri(config: AuthOidc): Promise<string> {
  if (config.jwksUri) return config.jwksUri;
  const cached = jwksUriCache.get(config.issuer);
  if (cached) return cached;
  const discoveryUrl = `${config.issuer.replace(/\/$/, "")}/.well-known/openid-configuration`;
  const resp = await fetch(discoveryUrl);
  if (!resp.ok) {
    throw new Error(`OIDC discovery failed: ${discoveryUrl} returned ${resp.status}`);
  }
  const doc = await resp.json() as { jwks_uri?: string };
  if (typeof doc.jwks_uri !== "string") {
    throw new Error(`OIDC discovery: jwks_uri not found in ${discoveryUrl}`);
  }
  jwksUriCache.set(config.issuer, doc.jwks_uri);
  return doc.jwks_uri;
}

async function verifyOidcAuth(
  request: Request,
  config: AuthOidc,
): Promise<AuthResult> {
  const challenge = { "WWW-Authenticate": `Bearer realm="prepalert"` };
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return { ok: false, status: 401, message: "Missing Bearer token", headers: challenge };
  }
  const token = authHeader.slice(7);

  try {
    const jwksUrlStr = await resolveJwksUri(config);
    let JWKS = jwksCache.get(jwksUrlStr);
    if (!JWKS) {
      JWKS = jose.createRemoteJWKSet(new URL(jwksUrlStr));
      jwksCache.set(jwksUrlStr, JWKS);
    }
    await jose.jwtVerify(token, JWKS, {
      issuer: config.issuer,
      audience: config.audience,
    });
    return { ok: true };
  } catch (e) {
    const message = e instanceof Error ? e.message : "JWT verification failed";
    return { ok: false, status: 401, message, headers: challenge };
  }
}
