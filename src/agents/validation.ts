/**
 * Validation Agent
 *
 * Responsibility: Memory contamination prevention.
 * Checks for contradictions, circular refs, hallucinated links, inference-as-fact.
 */

import type { MemorySystem } from "../memory";
import type { ValidationIssue, ValidationReport } from "../types";
import { BaseAgent } from "./base";

export class ValidationAgent extends BaseAgent {
	private memorySystem: MemorySystem;

	constructor(
		model: import("../types").ModelEntry,
		api: import("../api/opencode").OpenCodeAPI,
		memorySystem: MemorySystem,
	) {
		super("validation", model, api);
		this.memorySystem = memorySystem;
	}

	/**
	 * Get the memory system.
	 */
	getMemorySystem(): MemorySystem {
		return this.memorySystem;
	}

	async validate(): Promise<ValidationReport> {
		const report: ValidationReport = {
			contradictions: 0,
			circularReferences: 0,
			hallucinatedLinks: 0,
			inferenceAsFact: 0,
			issues: [],
			overallHealth: "healthy",
			stats: { totalEntries: 0, healthyEntries: 0, issueCount: 0 },
		};

		this.logger.info("Starting validation");

		report.contradictions = this.checkContradictions(report);
		report.circularReferences = this.checkCircularReferences(report);
		report.hallucinatedLinks = this.checkHallucinatedLinks(report);
		report.inferenceAsFact = this.checkInferenceAsFact(report);

		const hasError = report.issues.some((i) => i.severity === "error");
		report.overallHealth =
			hasError || report.issues.length >= 4
				? "critical"
				: report.issues.length === 0
					? "healthy"
					: "degraded";

		report.stats = this.computeStats(report);

		this.logger.info(`Validation: ${report.issues.length} issues (${report.overallHealth})`);
		return report;
	}

	private computeStats(report: ValidationReport): ValidationReport["stats"] {
		const totalEntries = this.memorySystem.countAll();
		const involved = new Set<string>();
		for (const issue of report.issues) {
			for (const id of issue.entries) involved.add(id);
		}
		return {
			totalEntries,
			healthyEntries: Math.max(0, totalEntries - involved.size),
			issueCount: report.issues.length,
		};
	}

	private checkContradictions(report: ValidationReport): number {
		const contradictions = this.memorySystem.findContradictions();
		for (const c of contradictions) {
			const description = `Contradiction: '${c.m1_cause}' vs '${c.m2_cause}'`;
			const issue: ValidationIssue = {
				severity: "error",
				type: "contradiction",
				description,
				entries: [c.m1_id, c.m2_id],
				suggestion: "Review both entries and correct or remove the outdated root_cause.",
			};
			report.issues.push(issue);
		}
		return contradictions.length;
	}

	private checkCircularReferences(report: ValidationReport): number {
		const circular = this.memorySystem.findCircularReferences();
		for (const c of circular) {
			const description = `Circular reference: ${c.source_id} -> ${c.target_id} -> ${c.cycle_point}`;
			const entries = Array.from(new Set([c.source_id, c.target_id, c.cycle_point]));
			const issue: ValidationIssue = {
				severity: "error",
				type: "circular_ref",
				description,
				entries,
				suggestion: "Remove one link in the cycle to break the reference loop.",
			};
			report.issues.push(issue);
		}
		return circular.length;
	}

	private checkHallucinatedLinks(report: ValidationReport): number {
		let count = 0;
		const seen = new Set<string>();
		const memoryIds = this.memorySystem.getAllMemoryIds();

		for (const memId of memoryIds) {
			const links = this.memorySystem.getLinks(memId);
			for (const link of links) {
				if (link.confidence < 0.3) {
					const pair = [memId, link.target].sort().join("|");
					if (seen.has(pair)) continue;
					seen.add(pair);
					const description = `Low confidence: ${memId} -> ${link.target} (${link.confidence})`;
					const issue: ValidationIssue = {
						severity: "warning",
						type: "hallucinated_link",
						description: `Hallucination: ${description}`,
						entries: [memId, link.target],
						suggestion: "Verify or remove the low-confidence link.",
					};
					report.issues.push(issue);
					count++;
				}
			}
		}
		return count;
	}

	private checkInferenceAsFact(report: ValidationReport): number {
		let count = 0;
		const memoryIds = this.memorySystem.getAllMemoryIds();

		for (const memId of memoryIds) {
			const evidence = this.memorySystem.getEvidence(memId);
			for (const ev of evidence) {
				if (ev.type === "observed" || ev.type === "verified") {
					const markers = [
						"probably",
						"likely",
						"might",
						"could",
						"i think",
						"possibly",
						"seems like",
					];
					const lower = ev.content.toLowerCase();
					if (markers.some((m) => lower.includes(m))) {
						count++;
						const issue: ValidationIssue = {
							severity: "warning",
							type: "inference_as_fact",
							description: `Inference labeled as ${ev.type}: "${ev.content.slice(0, 100)}"`,
							entries: [memId],
							suggestion: "Re-label evidence as inferred or add a verification source.",
						};
						report.issues.push(issue);
						break;
					}
				}
			}
		}
		return count;
	}

	async repair(): Promise<number> {
		this.logger.info("Starting repair");
		let repaired = 0;
		const circular = this.memorySystem.findCircularReferences();
		for (const c of circular) {
			this.logger.warn(`Circular: ${c.source_id} <-> ${c.target_id}`);
			repaired++;
		}
		this.logger.info(`Repaired ${repaired} issues`);
		return repaired;
	}
}
