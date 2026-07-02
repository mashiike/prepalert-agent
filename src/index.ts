import { join } from "node:path";
import { program } from "commander";
import pkg from "../package.json" with { type: "json" };
const { version } = pkg;
const bunVersion = typeof Bun !== "undefined" ? Bun.version : "unknown";
import { loadProject, type PermissionMode } from "./project.js";
import { executePrompt, executeInteractive } from "./commands/execute.js";
import { serveCommand } from "./commands/serve.js";
import { initProject } from "./commands/init.js";
import { createSkillsCommand } from "./commands/skills.js";
import { createDocsCommand } from "./commands/docs.js";
import { FileLogger, type LogLevel } from "./logger.js";
import { LocalTranscriptWriter } from "./transcript.js";
import { initTelemetry, shutdownTelemetry, isOTelEnabled, OTelLogger } from "./telemetry.js";

const VALID_PERMISSION_MODES: PermissionMode[] = ["default", "acceptEdits", "bypassPermissions", "plan", "dontAsk", "auto"];
const VALID_LOG_LEVELS: LogLevel[] = ["debug", "info", "warn", "error"];

function resolveLogLevel(cliValue: string | undefined): LogLevel {
  const raw = cliValue ?? process.env["PREPALERT_LOG_LEVEL"] ?? "info";
  if (VALID_LOG_LEVELS.includes(raw as LogLevel)) return raw as LogLevel;
  console.error(`error: invalid log level '${raw}'. Valid levels: ${VALID_LOG_LEVELS.join(", ")}`);
  process.exit(1);
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf-8");
}

async function loadProjectOrExit(projectDir: string) {
  try {
    return await loadProject(projectDir);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(`error: ${message}`);
    process.exit(1);
  }
}

program
  .name("prepalert-agent")
  .description("Alert response agent powered by Claude Agent SDK\nhttps://github.com/mashiike/prepalert-agent")
  .version(`${version} (bun ${bunVersion})`, "-v, --version")
  .option("--project-dir <dir>", "path to the alert response project directory (env: PREPALERT_PROJECT_DIR)", process.env["PREPALERT_PROJECT_DIR"] ?? ".")
  .option("--log-level <level>", "log level: debug, info, warn, error (env: PREPALERT_LOG_LEVEL)");

program
  .command("run", { isDefault: true })
  .description("Execute runbooks interactively or with a prompt")
  .option("-p <prompt>", "run non-interactively with the given prompt, use '-' to read from stdin")
  .option("-m, --interactive-permission-mode <mode>", "permission mode for interactive sessions (env: PREPALERT_PERMISSION_MODE)", process.env["PREPALERT_PERMISSION_MODE"] ?? "default")
  .option("--interactive-log-level <level>", "log level for interactive sessions (debug, info, warn, error)")
  .action(async (opts, cmd) => {
    const globals = cmd.optsWithGlobals();
    const projectDir = globals.projectDir as string;
    const project = await loadProjectOrExit(projectDir);
    const logsDir = join(project.dir, project.config.logsDir ?? "logs");
    const sessionsDir = join(project.dir, project.config.sessionsDir ?? "sessions");

    if (opts.p !== undefined) {
      const logLevel = resolveLogLevel(globals.logLevel as string | undefined);
      const fileLogger = new FileLogger(logsDir, logLevel, { stderrAll: true });
      const logger = isOTelEnabled() ? new OTelLogger(fileLogger) : fileLogger;
      logger.info("starting", { command: "run", mode: "headless", version, project: project.config.name, projectDir: project.dir, logLevel });
      const transcriptWriter = new LocalTranscriptWriter(sessionsDir, undefined, logger);
      logger.info("session created", { sessionId: transcriptWriter.sessionId, sessionDir: transcriptWriter.sessionDir });
      fileLogger.flush();
      const prompt = opts.p === "-" ? await readStdin() : opts.p as string;
      try {
        const result = await executePrompt(project, prompt, { logger, transcriptWriter });
        process.stdout.write(result.responseText);
        process.stdout.write("\n");
      } finally {
        fileLogger.flush();
        await shutdownTelemetry();
      }
    } else {
      if (!process.stdin.isTTY) {
        console.error("stdin is not a TTY. Use -p - to read from stdin.");
        process.exit(1);
      }
      const mode = opts.interactivePermissionMode as string;
      if (!VALID_PERMISSION_MODES.includes(mode as PermissionMode)) {
        console.error(`error: invalid permission mode '${mode}'. Valid modes: ${VALID_PERMISSION_MODES.join(", ")}`);
        process.exit(1);
      }
      const logLevel = resolveLogLevel(opts.interactiveLogLevel as string | undefined ?? globals.logLevel as string | undefined);
      const fileLogger = new FileLogger(logsDir, logLevel);
      const logger = isOTelEnabled() ? new OTelLogger(fileLogger) : fileLogger;
      logger.info("starting", { command: "run", mode: "interactive", version, project: project.config.name, projectDir: project.dir, logLevel });
      const transcriptWriter = new LocalTranscriptWriter(sessionsDir, undefined, logger);
      logger.info("session created", { sessionId: transcriptWriter.sessionId, sessionDir: transcriptWriter.sessionDir });
      fileLogger.flush();
      try {
        await executeInteractive(project, mode as PermissionMode, { logger, transcriptWriter });
      } finally {
        fileLogger.flush();
        await shutdownTelemetry();
      }
    }
  });

program
  .command("init")
  .description("Initialize a new alert response project")
  .action(async (_opts, cmd) => {
    const projectDir = cmd.optsWithGlobals().projectDir as string;
    const result = await initProject(projectDir);
    if (result.errors.length > 0) {
      for (const err of result.errors) {
        console.error(`error: ${err}`);
      }
      process.exit(1);
    }
    for (const file of result.created) {
      console.log(`  created: ${file}`);
    }
    for (const file of result.skipped) {
      console.log(`  skipped: ${file}`);
    }
    console.log("\nProject initialized. Edit prepalert.yaml to configure your agent.");
  });

program.addCommand(createSkillsCommand());
program.addCommand(createDocsCommand());

program
  .command("serve")
  .description("Start a webhook server")
  .option("--port <port>", "port to listen on")
  .action(async (opts, cmd) => {
    if (typeof Bun === "undefined") {
      console.error("error: 'serve' requires the Bun runtime (it uses Bun.serve). Run this command via the compiled binary or `bun run`, not plain Node.");
      process.exit(1);
    }
    const globals = cmd.optsWithGlobals();
    const projectDir = globals.projectDir as string;
    const logLevel = resolveLogLevel(globals.logLevel as string | undefined);
    const project = await loadProjectOrExit(projectDir);
    const configuredPort: unknown = project.config.serve?.port ?? 8080;
    const rawPort = opts.port ? parseInt(opts.port as string, 10) : configuredPort;
    if (typeof rawPort !== "number" || Number.isNaN(rawPort) || rawPort < 1 || rawPort > 65535) {
      console.error(`Invalid port: ${opts.port ?? configuredPort}`);
      process.exit(1);
    }
    const port = rawPort;
    const logsDir = join(project.dir, project.config.logsDir ?? "logs");
    const sessionsDir = join(project.dir, project.config.sessionsDir ?? "sessions");
    const fileLogger = new FileLogger(logsDir, logLevel, { stderrAll: true });
    const logger = isOTelEnabled() ? new OTelLogger(fileLogger) : fileLogger;
    logger.info("starting", { command: "serve", version, project: project.config.name, projectDir: project.dir, port, logLevel });
    fileLogger.flush();
    serveCommand(project, port, { logger, sessionsDir });
  });

initTelemetry(version);

await program.parseAsync();
