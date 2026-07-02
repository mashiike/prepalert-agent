import { describe, test, expect, afterEach } from "bun:test";
import { readFileSync, rmSync, existsSync, readdirSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FileLogger, StderrLogger, NullLogger } from "../logger.js";

function captureStderr(fn: () => void): string {
  const chunks: string[] = [];
  const original = process.stderr.write;
  process.stderr.write = (chunk: string | Uint8Array) => {
    chunks.push(typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk));
    return true;
  };
  try {
    fn();
  } finally {
    process.stderr.write = original;
  }
  return chunks.join("");
}

function makeTmpDir(): string {
  const dir = join(tmpdir(), `logger-test-${crypto.randomUUID().slice(0, 8)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("FileLogger", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs) {
      if (existsSync(dir)) rmSync(dir, { recursive: true });
    }
    dirs.length = 0;
  });

  test("writes JSON Lines to file", () => {
    const dir = makeTmpDir();
    dirs.push(dir);
    const logger = new FileLogger(dir, "debug", 1);
    captureStderr(() => logger.info("hello", { key: "value" }));
    logger.flush();

    const files = readdirSync(dir).filter(f => f.endsWith(".jsonl"));
    expect(files).toHaveLength(1);
    const content = readFileSync(join(dir, files[0]!), "utf-8");
    const parsed = JSON.parse(content.trim());
    expect(parsed.level).toBe("info");
    expect(parsed.msg).toBe("hello");
    expect(parsed.key).toBe("value");
    expect(parsed.time).toBeDefined();
  });

  test("respects log level for file output", () => {
    const dir = makeTmpDir();
    dirs.push(dir);
    const logger = new FileLogger(dir, "warn", 1);
    captureStderr(() => {
      logger.debug("debug");
      logger.info("info");
      logger.warn("warn");
      logger.error("error");
    });
    logger.flush();

    const files = readdirSync(dir).filter(f => f.endsWith(".jsonl"));
    expect(files).toHaveLength(1);
    const content = readFileSync(join(dir, files[0]!), "utf-8");
    const lines = content.trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!).level).toBe("warn");
    expect(JSON.parse(lines[1]!).level).toBe("error");
  });

  test("outputs warn and error to stderr regardless of file log level", () => {
    const dir = makeTmpDir();
    dirs.push(dir);
    const logger = new FileLogger(dir, "debug", 100);
    const output = captureStderr(() => {
      logger.debug("debug");
      logger.info("info");
      logger.warn("warn msg");
      logger.error("error msg");
    });
    const lines = output.trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!).level).toBe("warn");
    expect(JSON.parse(lines[1]!).level).toBe("error");
  });

  test("flushes when threshold reached", () => {
    const dir = makeTmpDir();
    dirs.push(dir);
    const logger = new FileLogger(dir, "debug", 2);
    logger.info("one");
    logger.info("two");

    const files = readdirSync(dir).filter(f => f.endsWith(".jsonl"));
    expect(files).toHaveLength(1);
    const content = readFileSync(join(dir, files[0]!), "utf-8");
    expect(content.trim().split("\n")).toHaveLength(2);
  });

  test("flush is safe when buffer is empty", () => {
    const dir = makeTmpDir();
    dirs.push(dir);
    const logger = new FileLogger(dir, "info", 100);
    logger.flush();
    const files = readdirSync(dir).filter(f => f.endsWith(".jsonl"));
    expect(files).toHaveLength(0);
  });

  test("stderrAll outputs all log levels to stderr", () => {
    const dir = makeTmpDir();
    dirs.push(dir);
    const logger = new FileLogger(dir, "debug", { stderrAll: true, flushThreshold: 100 });
    const output = captureStderr(() => {
      logger.debug("debug msg");
      logger.info("info msg");
      logger.warn("warn msg");
      logger.error("error msg");
    });
    const lines = output.trim().split("\n");
    expect(lines).toHaveLength(4);
    expect(JSON.parse(lines[0]!).level).toBe("debug");
    expect(JSON.parse(lines[1]!).level).toBe("info");
    expect(JSON.parse(lines[2]!).level).toBe("warn");
    expect(JSON.parse(lines[3]!).level).toBe("error");
  });

  test("stderrAll respects minLevel", () => {
    const dir = makeTmpDir();
    dirs.push(dir);
    const logger = new FileLogger(dir, "warn", { stderrAll: true, flushThreshold: 100 });
    const output = captureStderr(() => {
      logger.debug("debug msg");
      logger.info("info msg");
      logger.warn("warn msg");
      logger.error("error msg");
    });
    const lines = output.trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!).level).toBe("warn");
    expect(JSON.parse(lines[1]!).level).toBe("error");
  });
});

describe("StderrLogger", () => {
  test("outputs JSON to stderr", () => {
    const logger = new StderrLogger("debug");
    const output = captureStderr(() => logger.info("hello", { key: "value" }));
    const parsed = JSON.parse(output.trim());
    expect(parsed.level).toBe("info");
    expect(parsed.msg).toBe("hello");
    expect(parsed.key).toBe("value");
    expect(parsed.time).toBeDefined();
  });

  test("respects log level", () => {
    const logger = new StderrLogger("warn");
    const output = captureStderr(() => {
      logger.debug("debug msg");
      logger.info("info msg");
      logger.warn("warn msg");
      logger.error("error msg");
    });
    const lines = output.trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!).level).toBe("warn");
    expect(JSON.parse(lines[1]!).level).toBe("error");
  });
});

describe("NullLogger", () => {
  test("outputs nothing", () => {
    const logger = new NullLogger();
    const output = captureStderr(() => {
      logger.debug("debug");
      logger.info("info");
      logger.warn("warn");
      logger.error("error");
    });
    expect(output).toBe("");
  });
});
