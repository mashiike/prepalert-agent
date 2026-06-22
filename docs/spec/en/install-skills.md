# `install-skills` Subcommand

## Overview

A command that installs skill files provided by prepalert-agent into Claude Code or other agent tools. It does not require AI (Anthropic API).

Skill files are bundled within the prepalert-agent binary and are placed in the specified target directory by this command.

## Usage

```bash
prepalert-agent install-skills [--target <target>]
```

## Options

### `--target`

- **Type:** `string`
- **Required:** No
- **Description:** The installation destination for skills. If omitted, an interactive selection prompt is displayed.

| Value | Installation Destination |
|---|---|
| `project` | `.claude/skills/` (project-local) |
| `user` | `~/.claude/skills/` (user-global) |
| Any path | Placed directly at the specified path |

Interactive selection choices:

```
? Select the skill installation destination
  (1) project — .claude/skills/ (project-local)
  (2) user    — ~/.claude/skills/ (user-global)
  (3) other   — Enter a path directly
```

## Installed Skills

### `initialize-prepalert-project`

A skill that provides AI-assisted project initialization.

**File structure at the installation destination:**

```
<target>/initialize-prepalert-project/SKILL.md
```

**Skill behavior:**

1. Runs scaffolding equivalent to `prepalert-agent init` (if not already initialized)
2. Reads the MCP server configuration from `.mcp.json`
3. Analyzes the project context (directory structure, existing configuration files, etc.)
4. Generates practical runbooks based on the tools available from MCP servers
5. Adjusts the `instructions` in `prepalert.yaml` as needed

## Relationship with Interactive Mode

The built-in command `/init` in interactive mode (`prepalert-agent run`) internally executes processing equivalent to the `initialize-prepalert-project` skill.

- Skills installed via `install-skills` can be used directly in Claude Code as `/initialize-prepalert-project`
- In prepalert-agent's interactive mode, the `/init` command internally invokes the same skill definition
- Both entry points operate based on the same skill definition, so the results are equivalent

## Future Extensions

Currently, only `initialize-prepalert-project` is provided. The following skills are planned for future addition:

- `generate-runbook` — Generates runbooks from existing alert history and MCP server information
- `analyze-alert` — Analyzes alert content and suggests response strategies

When multiple skills become available, individual selection via the `--skill <name>` option is planned, with all skills being installed when omitted.
