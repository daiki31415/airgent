/**
 * Memory Organizer Agent
 *
 * Responsibility: Structure raw logs into graph memories.
 */

import type { MemorySystem } from "../memory";
import type { RawLogRow } from "../storage/index";
import type { EvidenceEntry, EvidenceType } from "../types";
import { BaseAgent } from "./base";

interface LogPattern {
	bug: string;
	investigation: string;
	rootCause: string;
	fix: string;
	reason: string;
	evidenceItems: Array<{ content: string; source: string }>;
	files: string[];
	commands: string[];
}

export class MemoryOrganizerAgent extends BaseAgent {
	private memorySystem: MemorySystem;

	constructor(
		model: import("../types").ModelEntry,
		api: import("../api/opencode").OpenCodeAPI,
		memorySystem: MemorySystem,
	) {
		super("memory_organizer", model, api);
		this.memorySystem = memorySystem;
	}

	/**
	 * Get the memory system.
	 */
	getMemorySystem(): MemorySystem {
		return this.memorySystem;
	}

	/**
	 * Organize raw logs for a session into structured memories.
	 */
	async organize(sessionId: string): Promise<{ count: number; memories: string[] }> {
		const rawLogs = this.memorySystem.getRawLogsBySession(sessionId);
		if (rawLogs.length === 0) {
			this.logger.info("No raw logs to organize");
			return { count: 0, memories: [] };
		}

		this.logger.info(`Organizing ${rawLogs.length} raw logs`);
		const patterns = this.analyzeLogs(rawLogs);
		const memories: string[] = [];

		for (const pattern of patterns) {
			if (!pattern.bug) continue;

			const evidence: EvidenceEntry[] = pattern.evidenceItems.map((e) => ({
				type: this.classifyEvidence(e.content, e.source),
				content: e.content,
				source: e.source,
				timestamp: Date.now(),
			}));

			const memoryId = this.memorySystem.createMemory({
				sessionId,
				bug: pattern.bug,
				investigation: pattern.investigation,
				rootCause: pattern.rootCause,
				fix: pattern.fix,
				reason: pattern.reason,
				evidence,
				confidence: this.calculateConfidence(evidence),
				tags: this.extractTags(pattern),
				files: pattern.files,
				commands: pattern.commands,
			});

			memories.push(memoryId);
		}

		this.logger.info(`Created ${memories.length} memories`);
		return { count: memories.length, memories };
	}

	private analyzeLogs(logs: RawLogRow[]): LogPattern[] {
		const combinedLog = logs.map((l) => l.content).join("\n");
		const lines = combinedLog.split("\n");
		const patterns: LogPattern[] = [];

		let currentBug = "",
			currentInvestigation = "",
			currentFix = "",
			currentReason = "";

		for (const line of lines) {
			const lower = line.toLowerCase();
			if (/bug:|error:|issue:/.test(lower)) {
				if (currentBug && currentFix) {
					patterns.push({
						bug: currentBug,
						investigation: currentInvestigation,
						rootCause: "",
						fix: currentFix,
						reason: currentReason,
						evidenceItems: [
							{ content: currentBug, source: "log" },
							{ content: currentFix, source: "log" },
						],
						files: [],
						commands: [],
					});
				}
				currentBug = line;
				currentInvestigation = "";
				currentFix = "";
				currentReason = "";
			} else if (/investigat|root cause|reason:/.test(lower)) {
				currentInvestigation += `${line}\n`;
			} else if (/fix:|fixed|solution:/.test(lower)) {
				currentFix = line;
			} else if (/reason:|because/.test(lower)) {
				currentReason = line;
			}
		}

		if (currentBug) {
			patterns.push({
				bug: currentBug,
				investigation: currentInvestigation,
				rootCause: "",
				fix: currentFix,
				reason: currentReason,
				evidenceItems: [
					{ content: currentBug, source: "log" },
					{ content: currentFix, source: "log" },
				],
				files: [],
				commands: [],
			});
		}

		return patterns.length > 0
			? patterns
			: [
					{
						bug: combinedLog.slice(0, 200),
						investigation: "",
						rootCause: "",
						fix: "",
						reason: "",
						evidenceItems: [{ content: combinedLog.slice(0, 500), source: "log" }],
						files: [],
						commands: [],
					},
				];
	}

	protected classifyEvidence(content: string, source: string): EvidenceType {
		const lower = content.toLowerCase();
		const src = source.toLowerCase();

		if (/test passed|verified|confirmed/.test(lower) || src === "test") return "verified";
		if (
			src === "log" ||
			src === "console" ||
			lower.includes("output:") ||
			(!lower.includes("i think") && !lower.includes("probably") && !lower.includes("might"))
		)
			return "observed";
		if (src === "llm" || src === "model" || src === "generated") return "generated";
		return "inferred";
	}

	protected calculateConfidence(evidence: EvidenceEntry[]): number {
		if (evidence.length === 0) return 0.3;
		const weights: Record<EvidenceType, number> = {
			verified: 1.0,
			observed: 0.8,
			inferred: 0.4,
			generated: 0.3,
		};
		const total = evidence.reduce((s, e) => s + (weights[e.type] || 0.3), 0);
		return Math.min(total / evidence.length + 0.1, 1.0);
	}

	protected extractTags(pattern: { bug: string; fix: string; files: string[] }): string[] {
		const tags = new Set<string>();
		for (const file of pattern.files) {
			const ext = file.split(".").pop();
			if (ext) tags.add(ext);
		}
		for (const kw of [
			"error",
			"bug",
			"fix",
			"crash",
			"performance",
			"memory",
			"security",
			"type",
			"compile",
			"runtime",
			"async",
			"sync",
		]) {
			if (pattern.bug.toLowerCase().includes(kw)) tags.add(kw);
		}
		return Array.from(tags);
	}
}
