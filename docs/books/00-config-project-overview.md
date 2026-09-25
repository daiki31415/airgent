# プロジェクト概要 — Airgent

types: `config`
tags: `airgent`, `project-overview`, `opentui`, `typescript`, `bun`, `handover`

## What

AI agent framework with opentui TUI dashboard. Connects to OpenCode server, executes pipeline-based tasks via DAG, maintains persistent memory/compression in SQLite. Rich UI with header/footer borders, source-based colors, golden ratio layout.

## Why

Complete project overview for session handover. Covers all 24 source files, architecture, types, gotchas, security measures, MCP support, and current state.

## How

### Stack

- Runtime: Bun v1.x (bun init v1.3.14)
- TUI: @opentui/core ^0.2.12 (ScrollBox, Input, Box, Select, Text)
- DB: bun:sqlite (WAL mode, PRAGMA synchronous=NORMAL)
- LLM: OpenCode server (REST + SSE at http://127.0.0.1:4096)
- Auth: Basic auth via OPENCODE_SERVER_PASSWORD
- TypeScript (strict, noEmit, moduleResolution bundler)
- Dev deps: @types/bun

### Directory Layout

```
index.ts              Entry point (~50 lines)
src/
  Airgent.ts          Orchestrator (855 lines)
  types.ts            282 lines, all shared types
  config/             ConfigManager (~210 lines: settings, models, MCP servers)
  api/                OpenCodeAPI (~400 lines: REST + SSE + MCP methods)
  ui/                 UIManager (~350 lines: rich opentui TUI with header/footer/colors)
  agents/
    base.ts           74 lines (Abstract BaseAgent)
    planner.ts        68 lines (LLM-based node selector)
    worker.ts         80 lines
    compression.ts    87 lines
    validation.ts     118 lines
    watchdog.ts       122 lines
    context-inspector.ts 159 lines
    memory-organizer.ts  146 lines
  pipeline/           PipelineEngine (150 lines: DAG + buildDAG)
  memory/             MemorySystem (161 lines)
  compression/        CompressionManager (192 lines)
  storage/            Storage (381 lines: bun:sqlite, 8 tables)
  skills/             SkillsManager (108 lines)
  sync/               DeviceSync (105 lines)
  prompt/             PromptManager (78 lines)
  utils/
    logger.ts         98 lines
    smart-cat.ts      78 lines
    rate-limiter.ts   30 lines
    clipboard.ts      新規: フォールバックコピーチェーン
```

### 新機能: コピー

- `src/utils/clipboard.ts` — OSC52 → pbcopy → wl-copy → xclip/xsel → tempfile のフォールバックチェーン
- `src/ui/index.ts` — `copy()` public API, `showCopyToast()` 緑/赤トースト
- `src/Airgent.ts` — `/copy [text]` コマンド (引数なしで generatedOutput をコピー)

### Key Changes (since last update)

#### Refactoring

- selectModel() now delegates to showSelectMenu() (60 lines removed)
- buildPromptSpec() extracted from chat()/streamChat() (shared message-building)
- All `any` casts removed: validation.ts (contradictions/circular/memories typed), memory-organizer.ts (LogPattern interface), memory/index.ts ([] as, filter(Boolean) as, rowToMemory casts removed)
- pipelineData type-safe (Record<string,any> cast removed, direct typed key access)
- insertCompressedEntry/saveCompressedEntry merged (private runInsertCompressedEntry)
- UIPanel type removed from types.ts (dead code)
- firstDep() removed from build-dag.test.ts

#### MCP Support

- MCPServerConfig interface in types.ts (name, type local/remote, command[], url, enabled, env, headers)
- OpenCodeAPI: listMCP(), addMCP(name, config), connectMCP(name), disconnectMCP(name) via REST
- ConfigManager: loadMCPServers(), saveMCPServers() persisted to ~/.config/Airgent/mcp.json
- Airgent.ts: /mcp command with subcommands (list, add, add-remote, connect, disconnect, remove)
- Tests: api/__tests__/mcp.test.ts (11 tests), config/__tests__/mcp-config.test.ts (6 tests)

#### Rich UI

- Header Box (bordered, rounded, #3b4261) with Airgent title + status indicator
- Footer Box (bordered) with status bar (uptime, session, tokens, memory, errors, node)
- Source-based colors: user=#7dcfff, ai=#9ece6a, airgent=#e0af68, error=#f7768e, info=#c0caf5
- Golden ratio (1.618) flexGrow for scrollbox
- refreshHeaderAndFooter() called from updateStatus()
- Log display simplified (no timestamp, no level for info)

#### Test Expansion (65 -> 151 tests)

New test files:
- src/utils/\_\_tests\_\_/logger.test.ts (14 tests)
- src/prompt/\_\_tests\_\_/prompt-manager.test.ts (13 tests)
- src/storage/\_\_tests\_\_/storage.test.ts (22 tests: all 8 tables CRUD + edge cases)
- src/memory/\_\_tests\_\_/memory-system.test.ts (12 tests)

Extended:
- rate-limiter: +4 tests (negative maxTokens, lazy refill, edge cases)
- resolve-safe-path: +3 tests (mixed slashes, HOME path, sibling rejection)
- compression: +5 tests (empty array, special chars, dedup, uppercase errors, sudo commands)
- MCP api/config tests: 17 total

Total: 293 expect() calls, 0 failures

### All 8 Pipeline Nodes Real (no noops)

- clarify: LLM-based task analysis
- plan: LLM-based step-by-step plan
- prompt: Context assembly (memories + plan + clarified + task)
- generate: WorkerAgent.execute() with pipeline prompt
- test: LLM-based output review (keyword detection)
- merge: Summary assembly
- validate: Memory contamination check
- report: Memory organize + compress

### Security Measures

- resolveSafePath() path traversal guard
- SAFE_ENV_KEYS whitelist for child processes
- apiKey stripped before disk write (saveModels)
- 0o600 on all file writes
- RateLimiter(100,1000,100) in handleInput()
- sanitizeError() strips stacks, redacts HOME, 500-char cap
- Ephemeral OpenCode server sessions (no leak)
- os.homedir() everywhere (config, skills, storage)

### Startup

```
bun install && bun run index.ts [--debug] [--no-tui]
```

## Notes

- Build: `bun run tsc --noEmit` clean
- 151 tests across 12 files
- 0 `as any`
- Rate limiter 100 req/s
- 24 source files (+ clipboard.ts)
- MCP config at `~/.config/Airgent/mcp.json`
- Git: github.com/daiki31415/airgent
