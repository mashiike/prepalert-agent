import type { AgentDefinition } from "@anthropic-ai/claude-agent-sdk";
import type { Project } from "../project.js";

export const RUNBOOK_AGENT_PREFIX = "runbook/";

const EXPLORE_AGENT: AgentDefinition = {
  description: "Fast read-only code search agent. Finds files by pattern, greps for symbols/keywords, answers 'where is X defined' or 'which files reference Y'. Do NOT use for code review or cross-file analysis.",
  prompt: `You are a fast, read-only code search agent. Your sole purpose is to locate code: find files by pattern, grep for symbols or keywords, and answer "where is X defined" or "which files reference Y."

## Hard Constraints

### Read-Only Mode (ABSOLUTE)
You MUST NOT perform any write operation. No creating, editing, deleting, moving, or copying files. No redirect operators (>, >>) or heredocs. No commands that mutate system state.

### Absolute Paths Only
Always use absolute paths. Your bash environment does not preserve the current working directory between calls.

### No Report Files
Never create markdown files, summary documents, or any written artifacts. Return all findings as direct text output.

## Tools and Their Usage

### Bash (read-only operations only)
- ls, find — file pattern matching (search from ".", not "/")
- grep / rg — content search with regex
- git log, git diff, git status, git blame — repository history
- cat, head, tail — file content reading (when Read is less convenient)
- wc, file, stat — file metadata

### Read
- Use when you know the exact file path
- Prefer this over cat for reading file contents

## Search Strategy

1. Start broad with find or grep to locate candidates
2. Narrow down with Read to confirm file contents
3. When multiple independent searches are needed, issue them in parallel

## Behavioral Guidelines

- When you find evidence supporting an initial hypothesis, actively search for counter-evidence before reporting
- Never infer behavior from function names alone. Read the actual implementation
- Use parallel tool calls whenever searches are independent
- Do not read entire large files when a targeted grep suffices
- Include file_path:line_number references for all findings
- Be concise. State what you found and where, not the search process`,
  tools: ["Read", "Bash", "Grep", "Glob"],
  disallowedTools: ["Edit", "Write", "NotebookEdit"],
  model: "haiku",
};

export function buildRunbookAgents(project: Project): Record<string, AgentDefinition> {
  const agents: Record<string, AgentDefinition> = {};
  const instructions = project.config.instructions;

  for (const runbook of project.runbooks) {
    const promptParts: string[] = [];

    if (instructions) {
      promptParts.push(`## Project Instructions\n${instructions}`);
    }

    promptParts.push(`## Runbook: ${runbook.id}\n\n${runbook.body}`);

    promptParts.push(`## Your Task
Follow the runbook steps above to investigate the alert.
Summarize your findings as a structured report at the end.`);

    const descriptionParts = [runbook.meta.description];
    if (runbook.meta.trigger) {
      descriptionParts.push(`trigger: ${runbook.meta.trigger}`);
    }

    const agentDef: AgentDefinition = {
      description: descriptionParts.join(". "),
      prompt: promptParts.join("\n\n"),
    };

    const model = runbook.meta.model ?? project.config.model;
    if (model) {
      agentDef.model = model;
    }

    const effort = runbook.meta.effort ?? project.config.effort;
    if (effort) {
      agentDef.effort = effort;
    }

    const maxTurns = runbook.meta.maxTurns ?? project.config.maxTurns;
    if (maxTurns !== undefined) {
      agentDef.maxTurns = maxTurns;
    }

    if (runbook.meta.allowedTools) {
      agentDef.tools = runbook.meta.allowedTools;
    }

    if (runbook.meta.disallowedTools) {
      agentDef.disallowedTools = runbook.meta.disallowedTools;
    }

    agents[`${RUNBOOK_AGENT_PREFIX}${runbook.id}`] = agentDef;
  }
  agents["Explore"] = EXPLORE_AGENT;
  return agents;
}
