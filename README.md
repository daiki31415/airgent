# Airgent

AI Agent Framework with TUI Dashboard — "Robustness over smartness"

## Overview

Airgent is a local-first AI agent framework that connects to an [OpenCode](https://opencode.ai) server and executes tasks through a DAG-based pipeline with 7 specialized agents. It maintains persistent memory, compression, and validation in SQLite.

## Requirements

- **Bun** v1.2+ (runtime)
- **OpenCode Server** running locally (`opencode serve`)

## Platform Support

| Platform | Status |
|---|---|
| Linux | Fully Supported |
| macOS | Experimental |
| Windows | Not Supported |

## Installation

```bash
git clone https://github.com/daiki31415/airgent.git
cd airgent
bun install
bun run build
```

## Run

```bash
bun run airgent
# または
bun run src/index.ts
```

## Configuration

Config files are stored in `~/.config/Airgent/`:

| File | Purpose |
|------|---------|
| `models.json` | Model selection per role (planner, generate, compression, validation, watchdog) |
| `settings.json` | UI refresh, token limits, debug flags |
| `constitution.md` | Principles, constraints, ethical guidelines (markdown) |
| `persona.md` | Assistant name, role, tone, rules |
| `mcp.json` | MCP server configurations |

Run `/model` in the TUI to configure models interactively.

## Architecture

- **7 Specialized Agents**: Planner, Worker, Memory Organizer, Compression, Validation, Watchdog, Context Inspector
- **DAG Pipeline**: Topological parallel execution (clarify → plan → generate → {test, validate} → report)
- **Persistent Memory**: SQLite (WAL mode) with structured memories, evidence, and auto-linking
- **Compression**: Semantic compression with metadata extraction (topics, files, commands, errors)
- **TUI Dashboard**: opentui-based with golden-ratio layout, source-colored logs, select menus

## Commands

| Command | Description |
|---------|-------------|
| `/help` | Show all commands |
| `/model` | Configure models per role |
| `/mcp` | Manage MCP servers |
| `/setting` | View/edit settings |
| `/session` | Session management |
| `/compress` | Trigger context compression |
| `/cat <file>` | Read file with syntax highlighting |
| `/copy [text]` | Copy to clipboard |
| `/debug` | Toggle debug mode |
| `/quit` | Exit |

## Development

```bash
# Run tests
bun test

# Type check
bun run typecheck

# Lint
bun run lint

# Build (outputs to dist/)
bun run build
```

## License

MIT License — see [LICENSE](LICENSE)