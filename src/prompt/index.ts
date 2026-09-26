/**
 * Prompt Manager
 *
 * Builds system prompts from system.md template + config + runtime context.
 * Enforces 3000 token limit.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { SkillsManager } from "../skills";
import type { AirgentConfig } from "../types";
import { rootLogger } from "../utils/logger";

export class PromptManager {
	private config: AirgentConfig;
	private skills: SkillsManager;
	private _template: string | null = null;
	private _nodeTemplates: Map<string, string> = new Map();

	constructor(config: AirgentConfig, skills: SkillsManager) {
		this.config = config;
		this.skills = skills;
	}

	private getTemplate(): string {
		if (!this._template) {
			const dir = fileURLToPath(new URL(".", import.meta.url));
			this._template = readFileSync(join(dir, "system.md"), "utf-8");
		}
		return this._template;
	}

	private getNodeTemplate(node: string): string {
		if (!this._nodeTemplates.has(node)) {
			const dir = fileURLToPath(new URL(".", import.meta.url));
			this._nodeTemplates.set(node, readFileSync(join(dir, "nodes", `${node}.md`), "utf-8"));
		}
		return this._nodeTemplates.get(node)!;
	}

	/**
	 * Build the node-specific system prompt, combining base system prompt
	 * with the node instruction file.
	 */
	buildNodePrompt(node: string): string {
		const base = this.buildSystemPrompt().prompt;
		const nodeInstr = this.getNodeTemplate(node);
		return `${base}\n\n---\n\n${nodeInstr}`;
	}

	/**
	 * Build the system prompt from the markdown template + config.
	 * Returns { prompt, tokenCount }.
	 */
	buildSystemPrompt(): { prompt: string; tokenCount: number } {
		let prompt = this.getTemplate();

		const c = this.config.constitution;
		prompt = prompt
			.replace("{{name}}", c.name)
			.replace("{{version}}", c.version)
			.replace("{{principles}}", c.principles.map((p) => `- ${p}`).join("\n"))
			.replace("{{constraints}}", c.constraints.map((c) => `- ${c}`).join("\n"))
			.replace("{{ethical_guidelines}}", c.ethical_guidelines.map((g) => `- ${g}`).join("\n"));

		const p = this.config.persona;
		prompt = prompt
			.replace("{{persona_name}}", p.name)
			.replace("{{role}}", p.role)
			.replace("{{tone}}", p.tone)
			.replace("{{rules}}", p.rules.map((r) => `- ${r}`).join("\n"));

		prompt = prompt.replace("{{debug}}", String(this.config.settings.debug));

		const index = this.skills.getIndex();
		const skillsSection =
			index.skills.length > 0
				? index.skills.map((s) => `- ${s.name}: ${s.description}`).join("\n")
				: "";
		prompt = prompt.replace("{{skills}}", skillsSection);

		if (!skillsSection) {
			prompt = prompt.replace(/\n---\n\n# Available Skills\n\n\n?$/, "");
		}

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
