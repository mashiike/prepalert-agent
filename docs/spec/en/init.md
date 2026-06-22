# `init` Subcommand

## Overview

A scaffolding command that generates initial prepalert-agent files in the project directory. Does not require AI (Anthropic API).

## Usage

```bash
prepalert-agent init [--project-dir <dir>]
```

## Generated Files

```
<project-dir>/
├── prepalert.yaml
├── .mcp.json               # Generated if not already present
├── .gitignore              # Generated if not already present, otherwise prompts to append
└── runbooks/
    └── example/
        └── 5xx-rate.md     # Sample runbook
```

## File Generation Rules

### `prepalert.yaml`

- If it already exists, exit with an error ("Already initialized")
- Generates a minimal template

Generated template:

```yaml
# Project name (used for logging and identification)
name: <directory name of project-dir>

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
# serve:
#   port: 8080
#   syncMode: false
#   webhooks:
#     - path: /webhook/alert
#       authType: none
```

### `.mcp.json`

- If it already exists, skip (do not modify)
- If it does not exist, generate an empty template

Generated template:

```json
{
  "mcpServers": {}
}
```

### `.gitignore`

- If it does not exist: generate a `.gitignore` containing `logs/` and `sessions/`
- If it already exists: if `logs/` and `sessions/` are not listed, prompt the user to confirm whether to append them (interactive prompt)
- If both are already listed: skip

### `runbooks/example/`

- Create the `runbooks/` directory and place a sample runbook in the `example/` subdirectory
- Do not error if `runbooks/` already exists (only add `example/`)
- If `runbooks/example/` already exists, skip

The sample runbook should be generic content that demonstrates the runbook structure (frontmatter + steps) without using MCP server-specific tool names.

## Execution Flow

1. Check for existence of `prepalert.yaml` → exit with error if it exists
2. Generate `prepalert.yaml`
3. Generate `.mcp.json` if it does not exist
4. Generate sample runbook in `runbooks/example/` if it does not exist
5. Process `.gitignore` (generate or prompt to append)
6. Display a list of generated files

## Relationship with Interactive Mode

The built-in command `/init` in interactive mode (`prepalert-agent run`) internally executes the `initialize-prepalert-project` skill. This skill performs the same scaffolding as the `init` subcommand, then has the AI read the project context (such as the MCP server configuration in `.mcp.json`) and generate practical runbooks. See [install-skills.md](./install-skills.md) for details.
