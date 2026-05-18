/**
 * Prompt Manager
 *
 * Builds system prompts from Constitution + Persona + Runtime context.
 * Enforces 3000 token limit.
 */

import type { AirgentConfig } from "../types";
import { SkillsManager } from "../skills";
import { rootLogger } from "../utils/logger";

export class PromptManager {
  private config: AirgentConfig;
  private skills: SkillsManager;

  constructor(config: AirgentConfig, skills: SkillsManager) {
    this.config = config;
    this.skills = skills;
  }

  /**
   * Build the 4-layer system prompt.
   * Returns { prompt, tokenCount }.
   */
  buildSystemPrompt(): { prompt: string; tokenCount: number } {
    const layers: string[] = [];

    // Layer 1: Constitution
    const c = this.config.constitution;
    layers.push([
      `[Constitution: ${c.name} v${c.version}]`,
      ...c.principles.map(p => `- ${p}`),
      ...c.constraints.map(c => `- Constraint: ${c}`),
      ...c.ethical_guidelines.map(g => `- Ethics: ${g}`),
    ].join("\n"));

    // Layer 2: Persona
    const p = this.config.persona;
    layers.push([
      `[Persona: ${p.name}]`,
      `Role: ${p.role}`,
      `Tone: ${p.tone}`,
      ...p.rules.map(r => `- ${r}`),
    ].join("\n"));

    // Layer 3: Runtime config
    layers.push([
      "[Runtime]",
      `Debug: ${this.config.settings.debug}`,
    ].join("\n"));

    // Layer 4: Skill Index (summary only)
    const index = this.skills.getIndex();
    if (index.skills.length > 0) {
      layers.push(
        "[Available Skills]\n" +
        index.skills.map(s => `- ${s.name}: ${s.description}`).join("\n")
      );
    }

    const prompt = layers.join("\n\n---\n\n");
    const tokenCount = Math.ceil(prompt.length / 4);

    if (tokenCount > (this.config.settings.maxSystemPromptTokens || 3000)) {
      rootLogger.warn(`System prompt exceeds limit: ${tokenCount} tokens`);
    }

    return { prompt, tokenCount };
  }

  /**
   * Check if a message would exceed the token limit.
   */
  wouldExceedLimit(additionalTokens: number): boolean {
    const { tokenCount } = this.buildSystemPrompt();
    return tokenCount + additionalTokens > (this.config.settings.maxSystemPromptTokens || 3000);
  }
}
