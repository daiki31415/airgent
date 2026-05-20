/**
 * Tests for config/index.ts (ConfigManager)
 *
 * Uses real filesystem operations in a temp directory.
 * A configDir option is passed to the ConfigManager constructor
 * to isolate all file I/O to the temp directory.
 *
 * No mock.module is used anywhere in this file.
 *
 * Covers load, save, get, set, settings, models, MCP, and edge cases.
 */

import { describe, expect, test, beforeAll, afterAll, beforeEach } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { ConfigManager } from "../index";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CONSTITUTION_CONTENT = `---
name: Test Constitution
version: 2.0.0
---

# Principles
- Test well

# Constraints
- No deletions

# Ethical Guidelines
- Be safe
`;

const PERSONA_CONTENT = `---
name: Test Persona
role: tester
tone: thorough
---

- Check everything
- Verify results
`;

const DEFAULT_MODELS = {
  planner: { provider: "", model: "" },
  generate: { provider: "", model: "" },
  compression: { provider: "", model: "" },
  validation: { provider: "", model: "" },
  watchdog: { provider: "", model: "" },
  fallback: [],
};

const DEFAULT_SETTINGS = {
  maxSystemPromptTokens: 3000,
  maxContextTokens: 32000,
  uiRefreshIntervalMs: 100,
  autoCompressThreshold: 0.7,
  watchdogIntervalMs: 5000,
  maxRetriesPerNode: 3,
  memoryAutoLink: true,
  showPipelineProgress: false,
  debug: false,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function writeFile(dir: string, name: string, content: string): void {
  fs.writeFileSync(path.join(dir, name), content, "utf-8");
}

function readFile(dir: string, name: string): string {
  return fs.readFileSync(path.join(dir, name), "utf-8");
}

/** Wipes a directory tree and recreates it empty. */
function resetDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
}

/** Seeds the standard set of config files into the given directory. */
function seedDefaults(configDir: string): void {
  fs.mkdirSync(configDir, { recursive: true });
  writeFile(configDir, "constitution.md", CONSTITUTION_CONTENT);
  writeFile(configDir, "persona.md", PERSONA_CONTENT);
  writeFile(configDir, "models.json", JSON.stringify(DEFAULT_MODELS));
  writeFile(configDir, "settings.json", JSON.stringify(DEFAULT_SETTINGS));
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("ConfigManager", () => {
  let tempDir: string;
  let configDir: string;

  beforeAll(() => {
    tempDir = fs.mkdtempSync("/tmp/airgent-config-test-");
    configDir = path.join(tempDir, ".config", "Airgent");
  });

  afterAll(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    resetDir(configDir);
    seedDefaults(configDir);
  });

  // -----------------------------------------------------------------------
  // Basic load tests
  // -----------------------------------------------------------------------

  test("load returns complete config with defaults", () => {
    const cm = new ConfigManager({ configDir });
    const config = cm.load();

    expect(config.constitution).toBeDefined();
    expect(config.persona).toBeDefined();
    expect(config.models).toBeDefined();
    expect(config.settings).toBeDefined();
  });

  test("load reads constitution frontmatter", () => {
    const cm = new ConfigManager({ configDir });
    const config = cm.load();

    expect(config.constitution.name).toBe("Test Constitution");
    expect(config.constitution.version).toBe("2.0.0");
  });

  test("load reads constitution principles", () => {
    const cm = new ConfigManager({ configDir });
    const config = cm.load();

    expect(config.constitution.principles).toContain("Test well");
  });

  test("load reads constitution constraints", () => {
    const cm = new ConfigManager({ configDir });
    const config = cm.load();

    expect(config.constitution.constraints).toContain("No deletions");
  });

  test("load reads persona frontmatter", () => {
    const cm = new ConfigManager({ configDir });
    const config = cm.load();

    expect(config.persona.name).toBe("Test Persona");
    expect(config.persona.role).toBe("tester");
    expect(config.persona.tone).toBe("thorough");
  });

  test("load reads persona rules (uses # persona section)", () => {
    // The extractList function looks for "# persona" sections.
    // Our test persona content doesn't have that heading, so rules
    // should be an empty array (defined and iterable).
    const cm = new ConfigManager({ configDir });
    const config = cm.load();

    expect(config.persona.rules).toBeDefined();
    expect(Array.isArray(config.persona.rules)).toBe(true);
  });

  test("load reads models from models.json", () => {
    const cm = new ConfigManager({ configDir });
    const config = cm.load();

    expect(config.models.planner.provider).toBe("");
    expect(config.models.generate.model).toBe("");
  });

  test("load reads settings from settings.json", () => {
    const cm = new ConfigManager({ configDir });
    const config = cm.load();

    expect(config.settings.maxSystemPromptTokens).toBe(3000);
    expect(config.settings.debug).toBe(false);
  });

  test("load returns cached config on second call", () => {
    const cm = new ConfigManager({ configDir });
    const c1 = cm.load();
    const c2 = cm.load();

    expect(c1).toBe(c2); // same reference
  });

  // -----------------------------------------------------------------------
  // needsConfig
  // -----------------------------------------------------------------------

  test("needsConfig returns true when models are empty", () => {
    const cm = new ConfigManager({ configDir });
    cm.load();

    expect(cm.needsConfig()).toBe(true);
  });

  test("needsConfig returns false when models are configured", () => {
    // Overwrite models.json with fully configured entries before loading.
    writeFile(
      configDir,
      "models.json",
      JSON.stringify({
        planner: { provider: "openai", model: "gpt-4" },
        generate: { provider: "openai", model: "gpt-4" },
        compression: { provider: "openai", model: "gpt-4" },
        validation: { provider: "openai", model: "gpt-4" },
        watchdog: { provider: "openai", model: "gpt-4" },
        fallback: [],
      }),
    );

    const cm = new ConfigManager({ configDir });
    cm.load();

    expect(cm.needsConfig()).toBe(false);
  });

  // -----------------------------------------------------------------------
  // saveSettings
  // -----------------------------------------------------------------------

  test("saveSettings persists partial settings", () => {
    const cm = new ConfigManager({ configDir });
    cm.load();
    cm.saveSettings({ debug: true, maxSystemPromptTokens: 5000 });

    const saved = JSON.parse(readFile(configDir, "settings.json"));
    expect(saved.debug).toBe(true);
    expect(saved.maxSystemPromptTokens).toBe(5000);
  });

  test("saveSettings merges with existing settings", () => {
    const cm = new ConfigManager({ configDir });
    cm.load();
    cm.saveSettings({ uiRefreshIntervalMs: 200 });

    const saved = JSON.parse(readFile(configDir, "settings.json"));
    expect(saved.uiRefreshIntervalMs).toBe(200);
    // Original values preserved
    expect(saved.maxContextTokens).toBe(32000);
  });

  // -----------------------------------------------------------------------
  // saveModels / getModels
  // -----------------------------------------------------------------------

  test("saveModels persists models without apiKey", () => {
    const cm = new ConfigManager({ configDir });
    cm.load();
    cm.saveModels({
      planner: { provider: "anthropic", model: "claude-3", apiKey: "sk-secret" },
    });

    const saved = JSON.parse(readFile(configDir, "models.json"));
    expect(saved.planner.provider).toBe("anthropic");
    expect(saved.planner.model).toBe("claude-3");
    // apiKey should be stripped before persisting
    expect(saved.planner.apiKey).toBeUndefined();
  });

  test("getModels returns models (shallow copy - top level)", () => {
    const cm = new ConfigManager({ configDir });
    cm.load();
    const models = cm.getModels();

    expect(models.planner).toBeDefined();
    expect(typeof models).toBe("object");
    expect(models.planner.provider).toBe("");
  });

  // -----------------------------------------------------------------------
  // MCP servers
  // -----------------------------------------------------------------------

  test("loadMCPServers returns empty array when no config", () => {
    // Ensure mcp.json does not exist (seedDefaults does NOT create it).
    const p = path.join(configDir, "mcp.json");
    if (fs.existsSync(p)) fs.unlinkSync(p);

    const cm = new ConfigManager({ configDir });
    cm.load();
    const servers = cm.loadMCPServers();

    expect(servers).toEqual([]);
  });

  test("loadMCPServers reads saved servers", () => {
    // Seed mcp.json with a server entry.
    writeFile(
      configDir,
      "mcp.json",
      JSON.stringify({
        servers: [
          { name: "playwright", type: "local", command: ["npx", "playwright"], enabled: true },
        ],
      }),
    );

    const cm = new ConfigManager({ configDir });
    cm.load();
    const servers = cm.loadMCPServers();

    expect(servers).toHaveLength(1);
    expect(servers[0]!.name).toBe("playwright");
  });

  test("saveMCPServers persists to disk", () => {
    const cm = new ConfigManager({ configDir });
    cm.load();
    cm.saveMCPServers([
      {
        name: "custom",
        type: "remote",
        url: "https://mcp.example.com",
        enabled: false,
        headers: { Authorization: "token" },
      },
    ]);

    const saved = JSON.parse(readFile(configDir, "mcp.json"));
    expect(saved.servers).toHaveLength(1);
    expect(saved.servers[0].name).toBe("custom");
    expect(saved.servers[0].url).toBe("https://mcp.example.com");
  });

  // -----------------------------------------------------------------------
  // Edge cases: missing / invalid files
  // -----------------------------------------------------------------------

  test("load handles missing config files by creating defaults", () => {
    // Remove all config files so ConfigManager creates them from built-in defaults.
    resetDir(configDir);

    const cm = new ConfigManager({ configDir });
    const config = cm.load();

    // Files should now exist on disk
    expect(fs.existsSync(path.join(configDir, "constitution.md"))).toBe(true);
    expect(fs.existsSync(path.join(configDir, "persona.md"))).toBe(true);
    expect(fs.existsSync(path.join(configDir, "models.json"))).toBe(true);
    expect(fs.existsSync(path.join(configDir, "settings.json"))).toBe(true);

    // Config should contain the built-in defaults from source
    expect(config.constitution.name).toBe("Airgent Constitution");
    expect(config.persona.name).toBe("Airgent Assistant");
    expect(config.models.planner.provider).toBe("");
    expect(config.settings.maxSystemPromptTokens).toBe(3000);
  });

  test("invalid models.json falls back to defaults", () => {
    writeFile(configDir, "models.json", "not json");

    const cm = new ConfigManager({ configDir });
    cm.load();
    const models = cm.getModels();

    expect(models.planner.provider).toBe("");
  });

  test("invalid settings.json falls back to defaults", () => {
    writeFile(configDir, "settings.json", "broken");

    const cm = new ConfigManager({ configDir });
    const config = cm.load();

    // Should use DEFAULT_SETTINGS
    expect(config.settings.maxSystemPromptTokens).toBe(3000);
  });

  test("invalid mcp.json returns empty array", () => {
    writeFile(configDir, "mcp.json", "not json");

    const cm = new ConfigManager({ configDir });
    const servers = cm.loadMCPServers();

    expect(servers).toEqual([]);
  });

  test("mcp.json missing servers key returns empty array", () => {
    writeFile(configDir, "mcp.json", JSON.stringify({ not_servers: [] }));

    const cm = new ConfigManager({ configDir });
    const servers = cm.loadMCPServers();

    expect(servers).toEqual([]);
  });
});
