import { describe, test, expect } from "bun:test";
import { verifyAuth } from "../auth.js";

function makeRequest(headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/webhook", {
    method: "POST",
    headers,
    body: "{}",
  });
}

describe("verifyAuth", () => {
  describe("authType: none", () => {
    test("always succeeds", async () => {
      const result = await verifyAuth(makeRequest(), { authType: "none" });
      expect(result.ok).toBe(true);
    });
  });

  describe("authType: basic", () => {
    const config = { authType: "basic" as const, username: "admin", password: "secret" };

    test("succeeds with correct credentials", async () => {
      const encoded = btoa("admin:secret");
      const result = await verifyAuth(
        makeRequest({ authorization: `Basic ${encoded}` }),
        config,
      );
      expect(result.ok).toBe(true);
    });

    test("fails without authorization header", async () => {
      const result = await verifyAuth(makeRequest(), config);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.status).toBe(401);
        expect(result.headers?.["WWW-Authenticate"]).toBe('Basic realm="prepalert"');
      }
    });

    test("fails with wrong credentials", async () => {
      const encoded = btoa("admin:wrong");
      const result = await verifyAuth(
        makeRequest({ authorization: `Basic ${encoded}` }),
        config,
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.status).toBe(401);
        expect(result.message).toBe("Invalid credentials");
        expect(result.headers?.["WWW-Authenticate"]).toBe('Basic realm="prepalert"');
      }
    });

    test("fails with Bearer token instead of Basic", async () => {
      const result = await verifyAuth(
        makeRequest({ authorization: "Bearer some-token" }),
        config,
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.status).toBe(401);
        expect(result.headers?.["WWW-Authenticate"]).toBe('Basic realm="prepalert"');
      }
    });

    test("handles password containing colon", async () => {
      const colonConfig = { authType: "basic" as const, username: "user", password: "pass:word" };
      const encoded = btoa("user:pass:word");
      const result = await verifyAuth(
        makeRequest({ authorization: `Basic ${encoded}` }),
        colonConfig,
      );
      expect(result.ok).toBe(true);
    });
  });

  describe("authType: oidc", () => {
    const config = {
      authType: "oidc" as const,
      issuer: "https://accounts.google.com",
      audience: "my-project",
    };

    test("fails without authorization header", async () => {
      const result = await verifyAuth(makeRequest(), config);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.status).toBe(401);
        expect(result.message).toBe("Missing Bearer token");
        expect(result.headers?.["WWW-Authenticate"]).toBe('Bearer realm="prepalert"');
      }
    });

    test("fails with Basic auth instead of Bearer", async () => {
      const result = await verifyAuth(
        makeRequest({ authorization: "Basic dXNlcjpwYXNz" }),
        config,
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.status).toBe(401);
        expect(result.headers?.["WWW-Authenticate"]).toBe('Bearer realm="prepalert"');
      }
    });

    test("fails with invalid JWT", async () => {
      const result = await verifyAuth(
        makeRequest({ authorization: "Bearer invalid-token" }),
        config,
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.status).toBe(401);
        expect(result.headers?.["WWW-Authenticate"]).toBe('Bearer realm="prepalert"');
      }
    });
  });
});
