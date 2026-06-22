import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { isOTelEnabled, initTelemetry, shutdownTelemetry, OTelLogger, SessionTelemetry } from "../telemetry.js";
import { NullLogger } from "../logger.js";

describe("telemetry", () => {
  const originalEnv = { ...process.env };

  afterEach(async () => {
    process.env = { ...originalEnv };
    await shutdownTelemetry();
  });

  describe("isOTelEnabled", () => {
    test("disabled by default", () => {
      delete process.env["OTEL_EXPORTER_OTLP_ENDPOINT"];
      delete process.env["OTEL_SDK_DISABLED"];
      expect(isOTelEnabled()).toBe(false);
    });
  });

  describe("initTelemetry", () => {
    test("does not enable without OTEL_EXPORTER_OTLP_ENDPOINT", () => {
      delete process.env["OTEL_EXPORTER_OTLP_ENDPOINT"];
      initTelemetry("0.0.1");
      expect(isOTelEnabled()).toBe(false);
    });

    test("does not enable when OTEL_SDK_DISABLED=true", () => {
      process.env["OTEL_EXPORTER_OTLP_ENDPOINT"] = "http://localhost:4318";
      process.env["OTEL_SDK_DISABLED"] = "true";
      initTelemetry("0.0.1");
      expect(isOTelEnabled()).toBe(false);
    });
  });

  describe("OTelLogger", () => {
    test("delegates to inner logger", () => {
      const calls: Array<{ level: string; msg: string }> = [];
      const inner = {
        debug(msg: string) { calls.push({ level: "debug", msg }); },
        info(msg: string) { calls.push({ level: "info", msg }); },
        warn(msg: string) { calls.push({ level: "warn", msg }); },
        error(msg: string) { calls.push({ level: "error", msg }); },
      };

      const logger = new OTelLogger(inner);
      logger.debug("d");
      logger.info("i");
      logger.warn("w");
      logger.error("e");

      expect(calls).toEqual([
        { level: "debug", msg: "d" },
        { level: "info", msg: "i" },
        { level: "warn", msg: "w" },
        { level: "error", msg: "e" },
      ]);
    });

    test("flush delegates to inner logger if available", () => {
      let flushed = false;
      const inner = {
        debug() {},
        info() {},
        warn() {},
        error() {},
        flush() { flushed = true; },
      };

      const logger = new OTelLogger(inner);
      logger.flush();
      expect(flushed).toBe(true);
    });

    test("flush is no-op when inner logger has no flush", () => {
      const logger = new OTelLogger(new NullLogger());
      expect(() => logger.flush()).not.toThrow();
    });
  });

  describe("SessionTelemetry", () => {
    test("can be created and ended without OTel enabled", () => {
      const session = new SessionTelemetry("test-session");
      session.startTurn();
      session.startTools([{ id: "tool-1", name: "Bash" }]);
      session.endTools(["tool-1"]);
      session.recordResult(0.01, 1, false, {
        input_tokens: 100,
        output_tokens: 50,
      });
      session.end(0.01, false);
    });

    test("handles multiple turns", () => {
      const session = new SessionTelemetry("test-session");
      session.startTurn();
      session.recordResult(0.005, 1, false);
      session.startTurn();
      session.recordResult(0.01, 2, false);
      session.end(0.01, false);
    });

    test("handles orphaned tool spans on turn end", () => {
      const session = new SessionTelemetry("test-session");
      session.startTurn();
      session.startTools([{ id: "tool-1", name: "Bash" }]);
      session.startTurn();
      session.end(0, false);
    });
  });
});
