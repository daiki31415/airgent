/**
 * Validation Agent
 *
 * Responsibility: Memory contamination prevention.
 * Checks for contradictions, circular refs, hallucinated links, inference-as-fact.
 */

import type { MemorySystem } from "../memory";
import { BaseAgent } from "./base";

export interface ValidationReport {
	contradictions: number;
	circularReferences: number;
	hallucinatedLinks: number;
	inferenceAsFact: number;
	issues: string[];
	overallHealth: "healthy" | "warning" | "critical";
}

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

	async validate(): Promise<ValidationReport> {
		const report: ValidationReport = {
			contradictions: 0,
			circularReferences: 0,
			hallucinatedLinks: 0,
			inferenceAsFact: 0,
			issues: [],
			overallHealth: "healthy",
		};

		this.logger.info("Starting validation");

		report.contradictions = this.checkContradictions(report);
		report.circularReferences = this.checkCircularReferences(report);
		report.hallucinatedLinks = this.checkHallucinatedLinks(report);
		report.inferenceAsFact = this.checkInferenceAsFact(report);

		const total =
			report.contradictions +
			report.circularReferences +
			report.hallucinatedLinks +
			report.inferenceAsFact;
		report.overallHealth =
			total === 0 ? "healthy" : total <= 3 ? "warning" : "critical";

		this.logger.info(`Validation: ${total} issues (${report.overallHealth})`);
		return report;
	}

	private checkContradictions(report: ValidationReport): number {
		const contradictions = this.memorySystem.findContradictions();
		for (const c of contradictions) {
			report.issues.push(`Contradiction: '${c.m1_cause}' vs '${c.m2_cause}'`);
		}
		return contradictions.length;
	}

	private checkCircularReferences(report: ValidationReport): number {
		const circular = this.memorySystem.findCircularReferences();
		for (const c of circular) {
			report.issues.push(
				`Circular reference: ${c.source_id} -> ${c.target_id} -> ${c.cycle_point}`,
			);
		}
		return circular.length;
	}

	private checkHallucinatedLinks(report: ValidationReport): number {
		const flagged: string[] = [];
		const memories = this.memorySystem.findRelevant([], 0);

		for (const mem of memories) {
			const links = this.memorySystem.getLinks(mem.id);
			for (const link of links) {
				if (link.confidence < 0.3) {
					flagged.push(
						`Low confidence: ${mem.id} -> ${link.target} (${link.confidence})`,
					);
				}
			}
		}

		for (const issue of flagged) report.issues.push(`Hallucination: ${issue}`);
		return flagged.length;
	}

	private checkInferenceAsFact(report: ValidationReport): number {
		let count = 0;
		const memories = this.memorySystem.findRelevant([], 0);

		for (const mem of memories) {
			const evidence = this.memorySystem.getEvidence(mem.id);
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
						report.issues.push(
							`Inference labeled as ${ev.type}: "${ev.content.slice(0, 100)}"`,
						);
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
