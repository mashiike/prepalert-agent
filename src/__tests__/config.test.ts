import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { expandEnvVars, expandEnvVarsInObject, parseDuration } from "../config.js";

describe("expandEnvVars", () => {
  beforeEach(() => {
    process.env["TEST_VAR"] = "hello";
    process.env["TEST_VAR2"] = "world";
  });

  afterEach(() => {
    delete process.env["TEST_VAR"];
    delete process.env["TEST_VAR2"];
  });

  test("expands a single variable", () => {
    expect(expandEnvVars("${TEST_VAR}")).toBe("hello");
  });

  test("expands multiple variables", () => {
    expect(expandEnvVars("${TEST_VAR} ${TEST_VAR2}")).toBe("hello world");
  });

  test("leaves strings without variables unchanged", () => {
    expect(expandEnvVars("no vars here")).toBe("no vars here");
  });

  test("throws on undefined variable", () => {
    expect(() => expandEnvVars("${UNDEFINED_VAR}")).toThrow('Environment variable "UNDEFINED_VAR" is not set');
  });

  test("expands variable embedded in text", () => {
    expect(expandEnvVars("prefix-${TEST_VAR}-suffix")).toBe("prefix-hello-suffix");
  });

  describe("default values (:-)", () => {
    test("uses variable value when set and non-empty", () => {
      expect(expandEnvVars("${TEST_VAR:-fallback}")).toBe("hello");
    });

    test("uses default when variable is not set", () => {
      expect(expandEnvVars("${UNSET_VAR:-fallback}")).toBe("fallback");
    });

    test("uses default when variable is empty string", () => {
      process.env["EMPTY_VAR"] = "";
      expect(expandEnvVars("${EMPTY_VAR:-fallback}")).toBe("fallback");
      delete process.env["EMPTY_VAR"];
    });

    test("allows empty default", () => {
      expect(expandEnvVars("${UNSET_VAR:-}")).toBe("");
    });

    test("allows default containing special characters", () => {
      expect(expandEnvVars("${UNSET_VAR:-http://localhost:8080}")).toBe(
        "http://localhost:8080",
      );
    });
  });

  describe("default values (-)", () => {
    test("uses variable value when set", () => {
      expect(expandEnvVars("${TEST_VAR-fallback}")).toBe("hello");
    });

    test("uses empty variable value when set to empty", () => {
      process.env["EMPTY_VAR"] = "";
      expect(expandEnvVars("${EMPTY_VAR-fallback}")).toBe("");
      delete process.env["EMPTY_VAR"];
    });

    test("uses default when variable is not set", () => {
      expect(expandEnvVars("${UNSET_VAR-fallback}")).toBe("fallback");
    });
  });

  describe("alternate values (:+)", () => {
    test("uses alternate when variable is set and non-empty", () => {
      expect(expandEnvVars("${TEST_VAR:+alternate}")).toBe("alternate");
    });

    test("returns empty when variable is not set", () => {
      expect(expandEnvVars("${UNSET_VAR:+alternate}")).toBe("");
    });

    test("returns empty when variable is empty string", () => {
      process.env["EMPTY_VAR"] = "";
      expect(expandEnvVars("${EMPTY_VAR:+alternate}")).toBe("");
      delete process.env["EMPTY_VAR"];
    });
  });

  describe("alternate values (+)", () => {
    test("uses alternate when variable is set", () => {
      expect(expandEnvVars("${TEST_VAR+alternate}")).toBe("alternate");
    });

    test("uses alternate when variable is set to empty", () => {
      process.env["EMPTY_VAR"] = "";
      expect(expandEnvVars("${EMPTY_VAR+alternate}")).toBe("alternate");
      delete process.env["EMPTY_VAR"];
    });

    test("returns empty when variable is not set", () => {
      expect(expandEnvVars("${UNSET_VAR+alternate}")).toBe("");
    });
  });

  describe("error messages (:?)", () => {
    test("returns value when set and non-empty", () => {
      expect(expandEnvVars("${TEST_VAR:?must be set}")).toBe("hello");
    });

    test("throws custom message when not set", () => {
      expect(() => expandEnvVars("${UNSET_VAR:?must be set}")).toThrow(
        "must be set",
      );
    });

    test("throws custom message when empty", () => {
      process.env["EMPTY_VAR"] = "";
      expect(() => expandEnvVars("${EMPTY_VAR:?must be set}")).toThrow(
        "must be set",
      );
      delete process.env["EMPTY_VAR"];
    });

    test("throws default message when no custom message", () => {
      expect(() => expandEnvVars("${UNSET_VAR:?}")).toThrow(
        "UNSET_VAR: parameter null or not set",
      );
    });
  });

  describe("error messages (?)", () => {
    test("returns value when set", () => {
      expect(expandEnvVars("${TEST_VAR?must be set}")).toBe("hello");
    });

    test("returns empty value when set to empty", () => {
      process.env["EMPTY_VAR"] = "";
      expect(expandEnvVars("${EMPTY_VAR?must be set}")).toBe("");
      delete process.env["EMPTY_VAR"];
    });

    test("throws custom message when not set", () => {
      expect(() => expandEnvVars("${UNSET_VAR?must be set}")).toThrow(
        "must be set",
      );
    });

    test("throws default message when no custom message", () => {
      expect(() => expandEnvVars("${UNSET_VAR?}")).toThrow(
        "UNSET_VAR: parameter not set",
      );
    });
  });
});

describe("expandEnvVarsInObject", () => {
  beforeEach(() => {
    process.env["TEST_USER"] = "admin";
    process.env["TEST_PASS"] = "secret";
  });

  afterEach(() => {
    delete process.env["TEST_USER"];
    delete process.env["TEST_PASS"];
  });

  test("expands variables in nested objects", () => {
    const result = expandEnvVarsInObject({
      webhooks: [
        {
          path: "/webhook",
          username: "${TEST_USER}",
          password: "${TEST_PASS}",
        },
      ],
    });
    expect(result.webhooks[0]!.username).toBe("admin");
    expect(result.webhooks[0]!.password).toBe("secret");
  });

  test("leaves non-string values unchanged", () => {
    const result = expandEnvVarsInObject({
      port: 8080,
      enabled: true,
      name: "test",
    });
    expect(result.port).toBe(8080);
    expect(result.enabled).toBe(true);
    expect(result.name).toBe("test");
  });

  test("handles null and undefined", () => {
    expect(expandEnvVarsInObject(null)).toBe(null);
    expect(expandEnvVarsInObject(undefined)).toBe(undefined);
  });
});

describe("parseDuration", () => {
  test("parses seconds", () => {
    expect(parseDuration("30s")).toBe(30);
  });

  test("parses minutes", () => {
    expect(parseDuration("15m")).toBe(900);
  });

  test("parses hours", () => {
    expect(parseDuration("1h")).toBe(3600);
  });

  test("parses fractional values", () => {
    expect(parseDuration("1.5h")).toBe(5400);
    expect(parseDuration("0.5m")).toBe(30);
  });

  test("throws on invalid format", () => {
    expect(() => parseDuration("15")).toThrow("Invalid duration format");
    expect(() => parseDuration("abc")).toThrow("Invalid duration format");
    expect(() => parseDuration("15d")).toThrow("Invalid duration format");
    expect(() => parseDuration("")).toThrow("Invalid duration format");
  });
});
