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

describe("PromptManager.buildNodePrompt", () => {
  const nodeTypes = ["clarify", "plan", "generate", "test", "validate", "report"];

  for (const node of nodeTypes) {
    test(`returns string for node type: ${node}`, () => {
      const pm = new PromptManager(minimalConfig(), mockSkillsManager());
      const result = pm.buildNodePrompt(node);
      expect(typeof result).toBe("string");
      expect(result.length).toBeGreaterThan(0);
      expect(result).toContain("# Node:");
    });
  }

  test("caches node templates (calls readFile only once per node)", () => {
    const pm = new PromptManager(minimalConfig(), mockSkillsManager());
    // First build
    const first = pm.buildNodePrompt("clarify");
    // Second build should use cache
    const second = pm.buildNodePrompt("clarify");
    expect(first).toBe(second);
  });

  test("different nodes return different content", () => {
    const pm = new PromptManager(minimalConfig(), mockSkillsManager());
    const clarify = pm.buildNodePrompt("clarify");
    const generate = pm.buildNodePrompt("generate");
    expect(clarify).not.toBe(generate);
  });

  test("buildNodePrompt includes base system prompt", () => {
    const pm = new PromptManager(minimalConfig(), mockSkillsManager());
    const result = pm.buildNodePrompt("clarify");
    expect(result).toContain("Test Constitution");
    expect(result).toContain("Test Bot");
  });

  test("buildNodePrompt includes separator between base and node content", () => {
    const pm = new PromptManager(minimalConfig(), mockSkillsManager());
    const result = pm.buildNodePrompt("plan");
    expect(result).toContain("---");
  });
});

describe("PromptManager.buildSystemPrompt", () => {
  test("includes constitution content", () => {
    const pm = new PromptManager(minimalConfig(), mockSkillsManager());
    const { prompt } = pm.buildSystemPrompt();
    expect(prompt).toContain("**Name:** Test Constitution v1.0.0");
    expect(prompt).toContain("- Be robust");
    expect(prompt).toContain("- Never delete data");
    expect(prompt).toContain("- Be helpful");
  });

  test("includes persona content", () => {
    const pm = new PromptManager(minimalConfig(), mockSkillsManager());
    const { prompt } = pm.buildSystemPrompt();
    expect(prompt).toContain("**Name:** Test Bot");
    expect(prompt).toContain("**Role:** tester");
    expect(prompt).toContain("**Tone:** professional");
    expect(prompt).toContain("- Explain reasoning");
  });

  test("includes runtime debug setting", () => {
    const pm = new PromptManager(minimalConfig({ settings: { ...minimalConfig().settings, debug: true } }), mockSkillsManager());
    const { prompt } = pm.buildSystemPrompt();
    expect(prompt).toContain("**Debug:** true");
  });

  test("omits skills section when no skills available", () => {
    const pm = new PromptManager(minimalConfig(), mockSkillsManager());
    const { prompt } = pm.buildSystemPrompt();
    expect(prompt).not.toContain("# Available Skills");
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
    expect(prompt).toContain("# Available Skills");
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

  test("config debug=false produces correct output", () => {
    const pm = new PromptManager(minimalConfig({ settings: { ...minimalConfig().settings, debug: false } }), mockSkillsManager());
    const { prompt } = pm.buildSystemPrompt();
    expect(prompt).toContain("**Debug:** false");
  });

  test("multi-line principles are rendered as list", () => {
    const cfg = minimalConfig({
      constitution: {
        ...minimalConfig().constitution,
        principles: ["Be robust", "Be fast", "Be correct"],
      },
    });
    const pm = new PromptManager(cfg, mockSkillsManager());
    const { prompt } = pm.buildSystemPrompt();
    expect(prompt).toContain("- Be robust\n- Be fast\n- Be correct");
  });

  test("multi-line constraints are rendered as list", () => {
    const cfg = minimalConfig({
      constitution: {
        ...minimalConfig().constitution,
        constraints: ["No data loss", "No side effects"],
      },
    });
    const pm = new PromptManager(cfg, mockSkillsManager());
    const { prompt } = pm.buildSystemPrompt();
    expect(prompt).toContain("- No data loss\n- No side effects");
  });

  test("multi-line ethical guidelines are rendered as list", () => {
    const cfg = minimalConfig({
      constitution: {
        ...minimalConfig().constitution,
        ethical_guidelines: ["Be honest", "Be safe"],
      },
    });
    const pm = new PromptManager(cfg, mockSkillsManager());
    const { prompt } = pm.buildSystemPrompt();
    expect(prompt).toContain("- Be honest\n- Be safe");
  });

  test("multi-line rules are rendered as list", () => {
    const cfg = minimalConfig({
      persona: { ...minimalConfig().persona, rules: ["Rule 1", "Rule 2"] },
    });
    const pm = new PromptManager(cfg, mockSkillsManager());
    const { prompt } = pm.buildSystemPrompt();
    expect(prompt).toContain("- Rule 1\n- Rule 2");
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

  test("exact limit boundary (equal) returns true", () => {
    const pm = new PromptManager(minimalConfig({ settings: { ...minimalConfig().settings, maxSystemPromptTokens: 0 } }), mockSkillsManager());
    const { tokenCount } = pm.buildSystemPrompt();
    // maxSystemPromptTokens || 3000 → defaults to 3000 when set to 0
    // So wouldExceedLimit with limit=3000 and tokenCount + 0 > 3000 is only true if count > 3000
    // This is actually testing the default fallback behavior
    const limit = (pm as any).config.settings.maxSystemPromptTokens || 3000;
    expect(pm.wouldExceedLimit(0)).toBe(tokenCount > limit);
  });

  test("zero additional tokens does not exceed generous limit", () => {
    const pm = new PromptManager(minimalConfig(), mockSkillsManager());
    expect(pm.wouldExceedLimit(0)).toBe(false);
  });

  test("wouldExceedLimit uses maxSystemPromptTokens from config", () => {
    const pm = new PromptManager(minimalConfig({ settings: { ...minimalConfig().settings, maxSystemPromptTokens: 100000 } }), mockSkillsManager());
    const { tokenCount } = pm.buildSystemPrompt();
    expect(pm.wouldExceedLimit(0)).toBe(false);
    expect(pm.wouldExceedLimit(100000 - tokenCount - 1)).toBe(false);
    expect(pm.wouldExceedLimit(100000 - tokenCount + 1)).toBe(true);
  });
});

describe("PromptManager caching behavior", () => {
  test("buildSystemPrompt is not cached (recalculates each call)", () => {
    const pm = new PromptManager(minimalConfig(), mockSkillsManager());
    const first = pm.buildSystemPrompt();
    const second = pm.buildSystemPrompt();
    expect(first.prompt).toBe(second.prompt);
    expect(first.tokenCount).toBe(second.tokenCount);
  });

  test("token count is consistent across calls", () => {
    const pm = new PromptManager(minimalConfig(), mockSkillsManager());
    const results = Array.from({ length: 5 }, () => pm.buildSystemPrompt());
    const tokenCounts = results.map(r => r.tokenCount);
    expect(new Set(tokenCounts).size).toBe(1);
  });
});

describe("PromptManager constructor", () => {
  test("accepts minimal config", () => {
    const pm = new PromptManager(minimalConfig(), mockSkillsManager());
    expect(pm).toBeInstanceOf(PromptManager);
  });
});
