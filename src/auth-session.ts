import * as jose from "jose";
import type { Logger } from "./logger.js";

const SESSION_AUDIENCE = "prepalert:session";
const SESSION_COOKIE_NAME = "prepalert_session";
const STATE_COOKIE_NAME = "prepalert_oauth_state";
const SESSION_EXPIRES_IN = "24h";
const STATE_COOKIE_MAX_AGE = 600;

export interface OidcConfig {
  issuer: string;
  clientId: string;
  clientSecret: string;
  allowedDomains: string[] | undefined;
  sessionSecret: Uint8Array;
  baseUrl: string;
}

export interface SessionPayload {
  sub: string;
  email: string;
  name: string | undefined;
}

interface OidcEndpoints {
  authorizationEndpoint: string;
  tokenEndpoint: string;
  jwksUri: string;
}

const endpointsCache = new Map<string, OidcEndpoints>();

async function discoverOidcEndpoints(issuer: string): Promise<OidcEndpoints> {
  const cached = endpointsCache.get(issuer);
  if (cached) return cached;

  const url = `${issuer.replace(/\/$/, "")}/.well-known/openid-configuration`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`OIDC discovery failed: ${res.status} ${res.statusText}`);
  }
  const config = await res.json() as Record<string, unknown>;
  const authorizationEndpoint = config["authorization_endpoint"];
  const tokenEndpoint = config["token_endpoint"];
  const jwksUri = config["jwks_uri"];
  if (typeof authorizationEndpoint !== "string" || typeof tokenEndpoint !== "string" || typeof jwksUri !== "string") {
    throw new Error("OIDC discovery response missing required endpoints");
  }
  const endpoints: OidcEndpoints = { authorizationEndpoint, tokenEndpoint, jwksUri };
  endpointsCache.set(issuer, endpoints);
  return endpoints;
}

function generateCodeVerifier(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function generateCodeChallenge(verifier: string): Promise<string> {
  const data = new TextEncoder().encode(verifier);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return btoa(String.fromCharCode(...new Uint8Array(hash)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function isValidReturnTo(path: string): boolean {
  return /^\/[a-zA-Z0-9]/.test(path) && !path.includes("//");
}

function isLocalhost(baseUrl: string): boolean {
  try {
    const u = new URL(baseUrl);
    return u.hostname === "localhost" || u.hostname === "127.0.0.1";
  } catch {
    return false;
  }
}

function cookieAttributes(baseUrl: string, maxAge: number): string {
  const secure = !isLocalhost(baseUrl);
  return `HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
}

async function signState(payload: Record<string, string>, secret: Uint8Array): Promise<string> {
  return new jose.SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime(`${STATE_COOKIE_MAX_AGE}s`)
    .setIssuedAt()
    .sign(secret);
}

async function verifyState(token: string, secret: Uint8Array): Promise<Record<string, string> | null> {
  try {
    const { payload } = await jose.jwtVerify(token, secret);
    return payload as Record<string, string>;
  } catch {
    return null;
  }
}

export async function handleLogin(config: OidcConfig, returnTo?: string): Promise<Response> {
  const endpoints = await discoverOidcEndpoints(config.issuer);
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await generateCodeChallenge(codeVerifier);
  const nonce = crypto.randomUUID();

  const safeReturnTo = returnTo && isValidReturnTo(returnTo) ? returnTo : "/";

  const stateToken = await signState({
    cv: codeVerifier,
    rt: safeReturnTo,
    n: nonce,
  }, config.sessionSecret);

  const redirectUri = `${config.baseUrl}/auth/callback`;
  const params = new URLSearchParams({
    response_type: "code",
    client_id: config.clientId,
    redirect_uri: redirectUri,
    scope: "openid email profile",
    state: nonce,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    nonce,
  });

  const response = new Response(null, {
    status: 302,
    headers: {
      "Location": `${endpoints.authorizationEndpoint}?${params}`,
      "Set-Cookie": `${STATE_COOKIE_NAME}=${stateToken}; ${cookieAttributes(config.baseUrl, STATE_COOKIE_MAX_AGE)}`,
    },
  });
  return response;
}

export async function handleCallback(request: Request, config: OidcConfig, logger?: Logger): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const errorParam = url.searchParams.get("error");

  if (errorParam) {
    const desc = url.searchParams.get("error_description") ?? errorParam;
    logger?.warn("OIDC provider returned an error on callback", { error: errorParam, description: desc });
    return new Response(`Authentication failed: ${desc}`, { status: 403 });
  }
  if (!code) {
    return new Response("Missing authorization code", { status: 400 });
  }

  const stateCookie = parseCookie(request, STATE_COOKIE_NAME);
  if (!stateCookie) {
    return new Response("Missing state cookie", { status: 400 });
  }

  const stateParam = url.searchParams.get("state");
  const statePayload = await verifyState(stateCookie, config.sessionSecret);
  if (!statePayload || !statePayload["cv"] || !statePayload["rt"] || !statePayload["n"]) {
    return new Response("Invalid state", { status: 400 });
  }
  if (stateParam !== statePayload["n"]) {
    return new Response("State mismatch", { status: 400 });
  }

  const codeVerifier = statePayload["cv"];
  const returnTo = statePayload["rt"];
  const endpoints = await discoverOidcEndpoints(config.issuer);
  const redirectUri = `${config.baseUrl}/auth/callback`;

  const tokenRes = await fetch(endpoints.tokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code_verifier: codeVerifier,
    }),
  });

  if (!tokenRes.ok) {
    const body = await tokenRes.text();
    logger?.warn("OIDC token exchange failed", { status: tokenRes.status, body });
    return new Response("Token exchange failed", { status: 502 });
  }

  const tokenData = await tokenRes.json() as Record<string, unknown>;
  const idToken = tokenData["id_token"];
  if (typeof idToken !== "string") {
    return new Response("Missing id_token in token response", { status: 502 });
  }

  const jwks = jose.createRemoteJWKSet(new URL(endpoints.jwksUri));
  let idPayload: jose.JWTPayload;
  try {
    const verified = await jose.jwtVerify(idToken, jwks, {
      issuer: config.issuer,
      audience: config.clientId,
    });
    idPayload = verified.payload;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger?.warn("OIDC ID token verification failed", { error: msg });
    return new Response("ID token verification failed", { status: 403 });
  }

  if (idPayload["nonce"] !== statePayload["n"]) {
    return new Response("ID token nonce mismatch", { status: 403 });
  }

  if (idPayload["email_verified"] === false) {
    return new Response("Email not verified", { status: 403 });
  }

  const email = idPayload["email"];
  if (typeof email !== "string") {
    return new Response("Missing email in id_token", { status: 403 });
  }

  if (config.allowedDomains && config.allowedDomains.length > 0) {
    const domain = email.split("@")[1]?.toLowerCase();
    const allowedDomains = config.allowedDomains.map(d => d.toLowerCase());
    if (!domain || !allowedDomains.includes(domain)) {
      return new Response("Domain not allowed", { status: 403 });
    }
  }

  const sub = typeof idPayload["sub"] === "string" ? idPayload["sub"] : email;
  const name = typeof idPayload["name"] === "string" ? idPayload["name"] : undefined;

  const sessionToken = await new jose.SignJWT({ sub, email, ...(name ? { name } : {}) })
    .setProtectedHeader({ alg: "HS256" })
    .setAudience(SESSION_AUDIENCE)
    .setExpirationTime(SESSION_EXPIRES_IN)
    .setIssuedAt()
    .sign(config.sessionSecret);

  const sessionCookieMaxAge = 86400;
  const safeReturnTo = returnTo && isValidReturnTo(returnTo) ? returnTo : "/";

  const clearState = `${STATE_COOKIE_NAME}=; ${cookieAttributes(config.baseUrl, 0)}`;
  const setSession = `${SESSION_COOKIE_NAME}=${sessionToken}; ${cookieAttributes(config.baseUrl, sessionCookieMaxAge)}`;

  return new Response(null, {
    status: 302,
    headers: [
      ["Location", safeReturnTo],
      ["Set-Cookie", clearState],
      ["Set-Cookie", setSession],
    ],
  });
}

export function handleLogout(baseUrl: string): Response {
  return new Response(null, {
    status: 302,
    headers: {
      "Location": "/",
      "Set-Cookie": `${SESSION_COOKIE_NAME}=; ${cookieAttributes(baseUrl, 0)}`,
    },
  });
}

export async function verifySession(request: Request, config: OidcConfig): Promise<SessionPayload | null> {
  const token = parseCookie(request, SESSION_COOKIE_NAME);
  if (!token) return null;
  try {
    const { payload } = await jose.jwtVerify(token, config.sessionSecret, { audience: SESSION_AUDIENCE });
    const email = payload["email"];
    const sub = payload["sub"];
    if (typeof email !== "string" || typeof sub !== "string") return null;
    const result: SessionPayload = { sub, email, name: undefined };
    if (typeof payload["name"] === "string") {
      result.name = payload["name"];
    }
    return result;
  } catch {
    return null;
  }
}

export { resolveExportSecret as resolveSessionSecret } from "./export-token.js";

function parseCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  const prefix = `${name}=`;
  for (const part of header.split(";")) {
    const trimmed = part.trim();
    if (trimmed.startsWith(prefix)) {
      return trimmed.slice(prefix.length);
    }
  }
  return null;
}
