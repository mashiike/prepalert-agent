import { access, appendFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { createInterface } from "node:readline";

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function confirm(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  return new Promise((resolve) => {
    rl.question(`${question} (y/N) `, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === "y");
    });
  });
}

function generatePrepalertYaml(projectName: string): string {
  return `# Project name (used for logging and identification)
name: ${projectName}

# Model for the agent to use (e.g. haiku, sonnet, opus)
model: haiku

# Reasoning effort level (low, medium, high, xhigh, max)
# effort: medium

# Maximum number of turns per agent execution
maxTurns: 10

# Cost limit per execution in USD
# costLimit: 1.0

# Execution timeout (e.g. "30s", "15m", "1h"). Headless/serve mode only.
# timeout: 15m

# Directory for runbook files
# runbooksDir: runbooks

# Path to MCP server configuration
# mcpConfig: .mcp.json

# Common instructions for the agent (inline or from file, mutually exclusive)
# instructions: |
#   Write instructions for the agent here.
# instructionsFile: PREPALERT.md

# Serve command configuration
serve:
  port: 8080
  # syncMode: false
  # ecsTaskProtection: auto
  # exportSecret: \${PREPALERT_EXPORT_SECRET}
  # sessionSecret: \${PREPALERT_SESSION_SECRET}
  # auth:
  #   issuer: https://accounts.google.com
  #   clientId: \${OAUTH_CLIENT_ID}
  #   clientSecret: \${OAUTH_CLIENT_SECRET}
  #   allowedDomains:
  #     - example.com
  webhooks:
    - path: /webhook/alert
      authType: none
      # headerPrompt: "The following alert has been received:"
    # - path: /webhook/secure
    #   authType: basic
    #   username: \${WEBHOOK_USER}
    #   password: \${WEBHOOK_PASS}
    # - path: /webhook/oidc
    #   authType: oidc
    #   issuer: https://accounts.google.com
    #   audience: my-project
`;
}

const MCP_JSON_TEMPLATE = `{
  "mcpServers": {}
}
`;

const EXAMPLE_RUNBOOK = `---
description: Example runbook for investigating 5xx error rate alerts
trigger: When 5xx error rate exceeds threshold
model: haiku
effort: low
maxTurns: 5
costLimit: 0.10
---

1. Retrieve alert details to identify the affected service
2. Check recent logs for error patterns
3. Investigate recent deployments or configuration changes
4. Summarize findings with timeline and potential root cause
`;

const GITIGNORE_ENTRIES = ["logs/", "sessions/"];

const GITIGNORE_TEMPLATE = `# prepalert-agent
logs/
sessions/
`;

export interface InitResult {
  created: string[];
  skipped: string[];
  errors: string[];
}

export async function initProject(projectDir: string): Promise<InitResult> {
  const dir = resolve(projectDir);
  const result: InitResult = { created: [], skipped: [], errors: [] };

  const configPath = join(dir, "prepalert.yaml");
  if (await exists(configPath)) {
    result.errors.push("prepalert.yaml already exists. Project is already initialized.");
    return result;
  }

  const cleanupPaths: string[] = [];
  try {
    const projectName = basename(dir);
    await writeFile(configPath, generatePrepalertYaml(projectName), "utf-8");
    cleanupPaths.push(configPath);
    result.created.push("prepalert.yaml");

    const mcpConfigPath = join(dir, ".mcp.json");
    if (await exists(mcpConfigPath)) {
      result.skipped.push(".mcp.json (already exists)");
    } else {
      await writeFile(mcpConfigPath, MCP_JSON_TEMPLATE, "utf-8");
      cleanupPaths.push(mcpConfigPath);
      result.created.push(".mcp.json");
    }

    const exampleDir = join(dir, "runbooks", "example");
    const exampleRunbook = join(exampleDir, "5xx-rate.md");
    if (await exists(exampleDir)) {
      result.skipped.push("runbooks/example/ (already exists)");
    } else {
      await mkdir(exampleDir, { recursive: true });
      await writeFile(exampleRunbook, EXAMPLE_RUNBOOK, "utf-8");
      cleanupPaths.push(exampleDir);
      result.created.push("runbooks/example/5xx-rate.md");
    }

    const gitignorePath = join(dir, ".gitignore");
    if (await exists(gitignorePath)) {
      const content = await readFile(gitignorePath, "utf-8");
      const missing = GITIGNORE_ENTRIES.filter((entry) => !content.includes(entry));
      if (missing.length > 0) {
        const isTTY = process.stdin.isTTY === true;
        let shouldAppend = !isTTY;
        if (isTTY) {
          shouldAppend = await confirm(`Add ${missing.join(", ")} to .gitignore?`);
        }
        if (shouldAppend) {
          const suffix = content.endsWith("\n") ? "" : "\n";
          await appendFile(gitignorePath, `${suffix}# prepalert-agent\n${missing.join("\n")}\n`, "utf-8");
          result.created.push(`.gitignore (appended: ${missing.join(", ")})`);
        } else {
          result.skipped.push(`.gitignore (${missing.join(", ")} not added)`);
        }
      } else {
        result.skipped.push(".gitignore (already contains logs/ and sessions/)");
      }
    } else {
      await writeFile(gitignorePath, GITIGNORE_TEMPLATE, "utf-8");
      cleanupPaths.push(gitignorePath);
      result.created.push(".gitignore");
    }
  } catch (e) {
    for (const p of cleanupPaths.reverse()) {
      await rm(p, { recursive: true, force: true }).catch(() => {});
    }
    return {
      created: [],
      skipped: [],
      errors: [`initialization failed and was rolled back: ${e instanceof Error ? e.message : String(e)}`],
    };
  }

  return result;
}
