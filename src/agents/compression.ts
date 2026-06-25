/**
 * Compression Agent
 *
 * Responsibility: Context compression management.
 */

import type { CompressionManager } from "../compression";
import type { MemorySystem } from "../memory";
import type { AgentMessage, CompressedEntry } from "../types";
import { BaseAgent } from "./base";

export class CompressionAgent extends BaseAgent {
	private compressionManager: CompressionManager;

	constructor(
		model: import("../types").ModelEntry,
		api: import("../api/opencode").OpenCodeAPI,
		compressionManager: CompressionManager,
		memorySystem: MemorySystem,
	) {
		super("compression", model, api);
		this.compressionManager = compressionManager;
		this.memorySystem = memorySystem;
	}

	async compress(
		messages: AgentMessage[],
		threshold = 0.7,
	): Promise<{
		compressed: boolean;
		entries: CompressedEntry[];
		originalCount: number;
		compressedCount: number;
		reduction: string;
	}> {
		const totalTokens = messages.reduce(
			(sum, m) => sum + this.estimateTokens(m.content),
			0,
		);
		const maxTokens =
			(this.context?.state?.maxContextTokens as number) || 32000;
		const usageRatio = totalTokens / maxTokens;

		this.logger.info(
			`Context: ${totalTokens}/${maxTokens} (${(usageRatio * 100).toFixed(1)}%)`,
		);

		if (usageRatio < threshold) {
			return {
				compressed: false,
				entries: [],
				originalCount: messages.length,
				compressedCount: 0,
				reduction: "0%",
			};
		}

		const chunks = this.groupMessages(messages);
		const entries: CompressedEntry[] = [];

		for (const chunk of chunks) {
			const entry = await this.compressionManager.compress(chunk);
			entries.push(entry);
		}

		this.logger.info(
			`Compressed ${messages.length} -> ${entries.length} entries`,
		);
		return {
			compressed: true,
			entries,
			originalCount: messages.length,
			compressedCount: entries.length,
			reduction: `${((1 - entries.length / messages.length) * 100).toFixed(0)}%`,
		};
	}

	async decompress(entryIds: string[]): Promise<CompressedEntry[]> {
		const entries: CompressedEntry[] = [];
		for (const id of entryIds) {
			try {
				const entry = await this.compressionManager.decompress(id);
				entries.push(entry);
			} catch {
				this.logger.warn(`Failed to decompress: ${id}`);
			}
		}
		return entries;
	}

	private groupMessages(messages: AgentMessage[]): AgentMessage[][] {
		const chunks: AgentMessage[][] = [];
		let current: AgentMessage[] = [];
		let tokens = 0;

		for (const msg of messages) {
			const t = this.estimateTokens(msg.content);
			if (tokens + t > 4000 && current.length > 0) {
				chunks.push(current);
				current = [];
				tokens = 0;
			}
			current.push(msg);
			tokens += t;
		}
		if (current.length > 0) chunks.push(current);
		return chunks;
	}
}
