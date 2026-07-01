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
 * the dispatch audience and the originating webhook path, so a leaked token
 * only bypasses auth for the webhook it was issued for.
 */
export async function generateDispatchToken(secret: Uint8Array, expiresInSeconds: number, path: string): Promise<string> {
  return new jose.SignJWT({})
    .setProtectedHeader({ alg: ALG })
    .setSubject(path)
    .setAudience(DISPATCH_AUDIENCE)
    .setExpirationTime(Math.floor(Date.now() / 1000) + expiresInSeconds)
    .setIssuedAt()
    .sign(secret);
}

/**
 * Verifies a dispatch token. Returns true only for a valid, unexpired token
 * signed with the shared secret, carrying the dispatch audience, and scoped
 * to the given webhook path.
 */
export async function verifyDispatchToken(token: string, secret: Uint8Array, path: string): Promise<boolean> {
  try {
    await jose.jwtVerify(token, secret, { audience: DISPATCH_AUDIENCE, subject: path });
    return true;
  } catch {
    return false;
  }
}
