import * as jose from "jose";

const ALG = "HS256";
const DISPATCH_AUDIENCE = "prepalert:dispatch";

/**
 * HTTP header that carries the prepalert-issued dispatch token.
 * Kept separate from `Authorization` so it coexists with Cloud Run IAM /
 * Cloud Tasks OIDC tokens (which occupy `Authorization`).
 */
export const DISPATCH_TOKEN_HEADER = "prepalert-dispatch-token";

/**
 * Generates a signed JWT proving a request was dispatched by prepalert itself.
 * Signed with the shared secret (reused from serve.exportSecret) and scoped via
 * the dispatch audience so it cannot be confused with export tokens.
 */
export async function generateDispatchToken(secret: Uint8Array, expiresInSeconds: number): Promise<string> {
  return new jose.SignJWT({})
    .setProtectedHeader({ alg: ALG })
    .setAudience(DISPATCH_AUDIENCE)
    .setExpirationTime(Math.floor(Date.now() / 1000) + expiresInSeconds)
    .setIssuedAt()
    .sign(secret);
}

/**
 * Verifies a dispatch token. Returns true only for a valid, unexpired token
 * signed with the shared secret and carrying the dispatch audience.
 */
export async function verifyDispatchToken(token: string, secret: Uint8Array): Promise<boolean> {
  try {
    await jose.jwtVerify(token, secret, { audience: DISPATCH_AUDIENCE });
    return true;
  } catch {
    return false;
  }
}
