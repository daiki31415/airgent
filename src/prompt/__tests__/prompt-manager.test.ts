import { describe, expect, test } from "bun:test";
import { PromptManager } from "../index";
import type { AirgentConfig, Constitution, Persona } from "../../types";
import { SkillsManager } from "../../skills";

function mockSkillsManager(): SkillsManager {
  return new (class extends SkillsManager {
    constructor() { super(); }
    override getIndex() { return { skills: [] }; }
    override loadSkill() { return null; }
  })();
}

function minimalConfig(overrides?: Partial<AirgentConfig>): AirgentConfig {
  const constitution: Constitution = {
    name: "Test Constitution",
    version: "1.0.0",
    principles: ["Be robust"],
    constraints: ["Never delete data"],
    ethical_guidelines: ["Be helpful"],
  };
  const persona: Persona = {
    name: "Test Bot",
    role: "tester",
    tone: "professional",
    rules: ["Explain reasoning"],
  };
  return {
    constitution,
    persona,
    models: {
      planner: { provider: "", model: "" },
      generate: { provider: "", model: "" },
      compression: { provider: "", model: "" },
      validation: { provider: "", model: "" },
      watchdog: { provider: "", model: "" },
      fallback: [],
    },
    settings: {
      maxSystemPromptTokens: 3000,
      maxContextTokens: 32000,
      uiRefreshIntervalMs: 100,
      autoCompressThreshold: 0.7,
      watchdogIntervalMs: 5000,
      maxRetriesPerNode: 3,
      memoryAutoLink: true,
      showPipelineProgress: false,
      debug: false,
    },
    ...overrides,
  };
}

describe("PromptManager.buildSystemPrompt", () => {
  test("includes constitution content", () => {
    const pm = new PromptManager(minimalConfig(), mockSkillsManager());
    const { prompt } = pm.buildSystemPrompt();
    expect(prompt).toContain("[Constitution: Test Constitution v1.0.0]");
    expect(prompt).toContain("- Be robust");
    expect(prompt).toContain("- Constraint: Never delete data");
    expect(prompt).toContain("- Ethics: Be helpful");
  });

  test("includes persona content", () => {
    const pm = new PromptManager(minimalConfig(), mockSkillsManager());
    const { prompt } = pm.buildSystemPrompt();
    expect(prompt).toContain("[Persona: Test Bot]");
    expect(prompt).toContain("Role: tester");
    expect(prompt).toContain("Tone: professional");
    expect(prompt).toContain("- Explain reasoning");
  });

  test("includes runtime debug setting", () => {
    const pm = new PromptManager(minimalConfig({ settings: { ...minimalConfig().settings, debug: true } }), mockSkillsManager());
    const { prompt } = pm.buildSystemPrompt();
    expect(prompt).toContain("Debug: true");
  });

  test("omits skills section when no skills available", () => {
    const pm = new PromptManager(minimalConfig(), mockSkillsManager());
    const { prompt } = pm.buildSystemPrompt();
    expect(prompt).not.toContain("[Available Skills]");
  });

  test("includes skills section when skills exist", () => {
    const skills = new (class extends SkillsManager {
      constructor() { super(); }
      override getIndex() { return {
        skills: [
          { name: "web", description: "Web searching", tags: [], filePath: "/path" },
          { name: "code", description: "Code analysis", tags: [], filePath: "/path" },
        ],
      }; }
      override loadSkill() { return null; }
    })();
    const pm = new PromptManager(minimalConfig(), skills);
    const { prompt } = pm.buildSystemPrompt();
    expect(prompt).toContain("[Available Skills]");
    expect(prompt).toContain("- web: Web searching");
    expect(prompt).toContain("- code: Code analysis");
  });

  test("returns token count estimate", () => {
    const pm = new PromptManager(minimalConfig(), mockSkillsManager());
    const { prompt, tokenCount } = pm.buildSystemPrompt();
    expect(tokenCount).toBe(Math.ceil(prompt.length / 4));
    expect(tokenCount).toBeGreaterThan(0);
  });

  test("separates layers with dashes", () => {
    const pm = new PromptManager(minimalConfig(), mockSkillsManager());
    const { prompt } = pm.buildSystemPrompt();
    expect(prompt).toContain("\n\n---\n\n");
  });
});

describe("PromptManager.wouldExceedLimit", () => {
  test("returns false for empty additional tokens", () => {
    const pm = new PromptManager(minimalConfig(), mockSkillsManager());
    expect(pm.wouldExceedLimit(0)).toBe(false);
  });

  test("returns false for small additional tokens", () => {
    const pm = new PromptManager(minimalConfig(), mockSkillsManager());
    expect(pm.wouldExceedLimit(100)).toBe(false);
  });

  test("returns true when combined tokens exceed limit", () => {
    const pm = new PromptManager(minimalConfig({ settings: { ...minimalConfig().settings, maxSystemPromptTokens: 1 } }), mockSkillsManager());
    expect(pm.wouldExceedLimit(1)).toBe(true);
  });

  test("returns false when combined tokens are within limit", () => {
    const pm = new PromptManager(minimalConfig({ settings: { ...minimalConfig().settings, maxSystemPromptTokens: 99999 } }), mockSkillsManager());
    expect(pm.wouldExceedLimit(500)).toBe(false);
  });
});
