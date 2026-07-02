import { describe, test, expect } from "bun:test";
import { generateDispatchToken, verifyDispatchToken } from "../dispatch-token.js";
import * as jose from "jose";

const secret = new TextEncoder().encode("test-secret-key-test-secret-key-32");

describe("dispatch token", () => {
  test("verifies a freshly generated token for its own path", async () => {
    const token = await generateDispatchToken(secret, 900, "/webhook/a");
    expect(await verifyDispatchToken(token, secret, "/webhook/a")).toBe(true);
  });

  test("rejects a token when verified against a different path", async () => {
    const token = await generateDispatchToken(secret, 900, "/webhook/a");
    expect(await verifyDispatchToken(token, secret, "/webhook/b")).toBe(false);
  });

  test("rejects a token signed with a different secret (forgery)", async () => {
    const token = await generateDispatchToken(secret, 900, "/webhook/a");
    const otherSecret = new TextEncoder().encode("another-secret-another-secret-32x");
    expect(await verifyDispatchToken(token, otherSecret, "/webhook/a")).toBe(false);
  });

  test("rejects an expired token", async () => {
    const token = await generateDispatchToken(secret, -1, "/webhook/a");
    expect(await verifyDispatchToken(token, secret, "/webhook/a")).toBe(false);
  });

  test("rejects a token with a different audience", async () => {
    const token = await new jose.SignJWT({})
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("/webhook/a")
      .setAudience("prepalert:export")
      .setExpirationTime(Math.floor(Date.now() / 1000) + 900)
      .setIssuedAt()
      .sign(secret);
    expect(await verifyDispatchToken(token, secret, "/webhook/a")).toBe(false);
  });

  test("rejects a malformed token", async () => {
    expect(await verifyDispatchToken("not-a-jwt", secret, "/webhook/a")).toBe(false);
  });
});
