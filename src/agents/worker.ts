/**
 * Worker Agent
 *
 * Responsibility: Primary task execution.
 * Uses skills and compressed context for enhanced generation.
 */

import type { CompressionManager } from "../compression";
import type { MemorySystem } from "../memory";
import type { SkillsManager } from "../skills";
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

	async execute(
		prompt: string,
		onChunk?: (chunk: string) => void,
		topics?: string[],
	): Promise<{ content: string }> {
		this.logger.info(`Executing: ${prompt.slice(0, 100)}`);

		const decompressed =
			topics && topics.length > 0 ? this.compression.findForDecompression({ topics }) : [];
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
}
