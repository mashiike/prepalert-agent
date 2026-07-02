# `skills` Subcommand

## Overview

A command to install and manage skill files provided by prepalert-agent for Claude Code and other agent tools. Does not require AI (Anthropic API).

Skill files are bundled with the prepalert-agent binary and are placed in the specified directory by this command.

## Usage

```bash
prepalert-agent skills <subcommand> [options]
```

### Subcommands

| Command | Description |
|---|---|
| `list` | Show available bundled skills |
| `install` | Install skills |
| `update` | Update installed skills to latest version |
| `uninstall` | Remove installed skills |
| `status` | Show status of installed skills |

### `skills install`

```bash
prepalert-agent skills install [--scope <scope>] [--dry-run] [--force]
```

### Options

#### `--scope`

- **Type:** `string`
- **Required:** No
- **Description:** Installation destination. When omitted, an interactive prompt is shown.

| Value | Destination |
|---|---|
| `project` | `.claude/skills/` (project-local) |
| `user` | `~/.claude/skills/` (user-global) |

Interactive prompt choices:

```
? Select skill installation destination
  (1) project — .claude/skills/ (project-local)
  (2) user    — ~/.claude/skills/ (user-global)
  (3) other   — enter path directly
```

#### `--dry-run`

Preview changes without applying them.

#### `--force`

Overwrite existing skill files.

### `skills update`

```bash
prepalert-agent skills update [--scope <scope>] [--dry-run]
```

Update installed skills to the latest version. Use `--scope` to specify scope; when omitted, an interactive prompt is shown.

### `skills uninstall`

```bash
prepalert-agent skills uninstall [--scope <scope>] [--dry-run]
```

Remove installed skills.

### `skills status`

```bash
prepalert-agent skills status [--scope <scope>]
```

Show version and update status of installed skills.

## Installed Skills

### `prepalert-agent`

A skill that helps AI assist with project configuration, runbook authoring, and webhook server setup.

**Installed file structure:**

```
<scope>/prepalert-agent/
├── SKILL.md
└── references/
    ├── instructions-guide.md
    └── runbook-template.md
```

## Relationship with Interactive Mode

The built-in `/init` command in interactive mode (`prepalert-agent run`) performs equivalent processing internally.

- Skills installed via `skills install` can be used directly in Claude Code
- In prepalert-agent's interactive mode, the `/init` command internally calls the same skill definition
