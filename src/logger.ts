import { mkdirSync, appendFileSync } from "node:fs";
import { join } from "node:path";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogFields {
  [key: string]: unknown;
}

export interface Logger {
  debug(msg: string, fields?: LogFields): void;
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
}

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

function formatEntry(level: LogLevel, msg: string, fields?: LogFields): string {
  return JSON.stringify({ time: new Date().toISOString(), level, msg, ...fields });
}

export interface FileLoggerOptions {
  flushThreshold?: number;
  stderrAll?: boolean;
}

export class FileLogger implements Logger {
  private readonly filePath: string;
  private readonly minLevel: number;
  private buffer: string[] = [];
  private readonly flushThreshold: number;
  private readonly stderrAll: boolean;

  constructor(dir: string, level: LogLevel = "info", opts: FileLoggerOptions | number = 5) {
    mkdirSync(dir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const id = crypto.randomUUID().slice(0, 8);
    this.filePath = join(dir, `${ts}-${id}.jsonl`);
    this.minLevel = LOG_LEVEL_PRIORITY[level];
    if (typeof opts === "number") {
      this.flushThreshold = opts;
      this.stderrAll = false;
    } else {
      this.flushThreshold = opts.flushThreshold ?? 5;
      this.stderrAll = opts.stderrAll ?? false;
    }
  }

  debug(msg: string, fields?: LogFields): void { this.emit("debug", msg, fields); }
  info(msg: string, fields?: LogFields): void { this.emit("info", msg, fields); }
  warn(msg: string, fields?: LogFields): void { this.emit("warn", msg, fields); }
  error(msg: string, fields?: LogFields): void { this.emit("error", msg, fields); }

  flush(): void {
    if (this.buffer.length === 0) return;
    const data = this.buffer.join("\n") + "\n";
    this.buffer = [];
    try {
      appendFileSync(this.filePath, data);
    } catch {
      process.stderr.write(data);
    }
  }

  private emit(level: LogLevel, msg: string, fields?: LogFields): void {
    if (LOG_LEVEL_PRIORITY[level] < this.minLevel) return;
    const entry = formatEntry(level, msg, fields);
    this.buffer.push(entry);
    if (this.stderrAll || LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY["warn"]) {
      process.stderr.write(entry + "\n");
    }
    if (this.buffer.length >= this.flushThreshold) {
      this.flush();
    }
  }
}

export class StderrLogger implements Logger {
  private readonly minLevel: number;

  constructor(level: LogLevel = "info") {
    this.minLevel = LOG_LEVEL_PRIORITY[level];
  }

  debug(msg: string, fields?: LogFields): void { this.emit("debug", msg, fields); }
  info(msg: string, fields?: LogFields): void { this.emit("info", msg, fields); }
  warn(msg: string, fields?: LogFields): void { this.emit("warn", msg, fields); }
  error(msg: string, fields?: LogFields): void { this.emit("error", msg, fields); }

  private emit(level: LogLevel, msg: string, fields?: LogFields): void {
    if (LOG_LEVEL_PRIORITY[level] < this.minLevel) return;
    process.stderr.write(formatEntry(level, msg, fields) + "\n");
  }
}

export class NullLogger implements Logger {
  debug(_msg: string, _fields?: LogFields): void {}
  info(_msg: string, _fields?: LogFields): void {}
  warn(_msg: string, _fields?: LogFields): void {}
  error(_msg: string, _fields?: LogFields): void {}
}
