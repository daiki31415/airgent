/**
 * Worker Agent
 *
 * Responsibility: Primary task execution.
 * Uses skills and compressed context for enhanced generation.
 */

import type { CompressionManager } from "../compression";
import type { MemorySystem } from "../memory";
import type { SkillsManager } from "../skills";
import type { CompressedEntry } from "../types";
import { BaseAgent } from "./base";

export class WorkerAgent extends BaseAgent {
	private compression: CompressionManager;
	private memorySystem: MemorySystem;
	private skills: SkillsManager;

	constructor(
		model: import("../types").ModelEntry,
		api: import("../api/opencode").OpenCodeAPI,
		compression: CompressionManager,
		skills: SkillsManager,
		memorySystem: MemorySystem,
	) {
		super("worker", model, api);
		this.compression = compression;
		this.skills = skills;
		this.memorySystem = memorySystem;
	}

	/**
	 * Get the compression manager.
	 */
	getCompressionManager(): CompressionManager {
		return this.compression;
	}

	/**
	 * Get the memory system.
	 */
	getMemorySystem(): MemorySystem {
		return this.memorySystem;
	}

	/**
	 * Get the skills manager.
	 */
	getSkillsManager(): SkillsManager {
		return this.skills;
	}

	async execute(prompt: string, onChunk?: (chunk: string) => void): Promise<{ content: string }> {
		this.logger.info(`Executing: ${prompt.slice(0, 100)}`);

		const decompressed = this.findRelevantContext(prompt);
		let contextEnhancement = "";
		if (decompressed.length > 0) {
			contextEnhancement =
				"Relevant past context:\n" +
				decompressed
					.slice(0, 3)
					.map((e) => `- ${e.title}: ${e.topics.join(", ")}`)
					.join("\n");
		}

		const fullPrompt = [contextEnhancement, prompt].filter(Boolean).join("\n\n");

		this.memorySystem.recordRaw(
			this.context?.sessionId || "",
			"worker",
			fullPrompt,
			this.estimateTokens(fullPrompt),
		);

		if (onChunk) {
			let content = "";
			for await (const chunk of this.thinkStream(fullPrompt)) {
				content += chunk;
				onChunk(chunk);
			}
			this.memorySystem.recordRaw(
				this.context?.sessionId || "",
				"worker_response",
				content,
				this.estimateTokens(content),
			);
			return { content };
		}

		const result = await this.think(fullPrompt);
		this.memorySystem.recordRaw(
			this.context?.sessionId || "",
			"worker_response",
			result,
			this.estimateTokens(result),
		);
		return { content: result };
	}

	private findRelevantContext(prompt: string): CompressedEntry[] {
		const topics = this.extractTopics(prompt);
		return topics.length > 0 ? this.compression.findForDecompression({ topics }) : [];
	}

	private extractTopics(text: string): string[] {
		const topics = new Set<string>();

		const patterns = [
			// error: TypeError, bug: null-pointer, fix: memory-leak, issue: race-condition
			/(?:error|bug|fix|issue):\s*([a-zA-Z_][a-zA-Z0-9_-]*)/gi,

			// in/of/for the file.ts, in src/utils/helper.ts, for myFunction
			/(?:in|of|for)\s+(?:the\s+)?([a-zA-Z_][a-zA-Z0-9_-]*(?:[/.][a-zA-Z_][a-zA-Z0-9_-]*)*)/g,

			// Common error types
			/\b(?:TypeError|ReferenceError|SyntaxError|RangeError|Error|Exception)\w*/g,

			// camelCase identifiers (function names, variables)
			/\b[a-z]+(?:[A-Z][a-z0-9]+)+\b/g,

			// kebab-case identifiers (file names, CSS classes, CLI flags)
			/\b[a-z]+(?:-[a-z0-9]+)+\b/g,

			// snake_case identifiers (Python, configs, env vars)
			/\b[a-z_][a-z0-9_]*\b/g,

			// File paths with extensions
			/\b[a-zA-Z_][a-zA-Z0-9_\-/]*\.(?:ts|js|tsx|jsx|json|md|py|rs|go|java|cpp|h)\b/g,

			// Function calls: foo(), bar.baz(), obj.method()
			/\b[a-zA-Z_][a-zA-Z0-9_.]*\(\)/g,
		];

		for (const pattern of patterns) {
			for (const match of text.matchAll(pattern)) {
				if (match) {
					const captured = match[match.length - 1] || match[0];
					if (captured && captured.length > 2) {
						// Normalize: lowercase, strip trailing ()
						const normalized = captured.replace(/\(\)$/, "").toLowerCase();
						topics.add(normalized);
					}
				}
			}
		}
		return Array.from(topics);
	}
}
