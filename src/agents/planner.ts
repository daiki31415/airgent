/**
 * Planner Agent
 *
 * Responsibility: Task decomposition and pipeline node selection.
 * LLM-based selector that decides which pipeline stages to run.
 */

import type { PipelineNode } from "../types";
import { BaseAgent } from "./base";

const ALL_NODES: PipelineNode[] = [
	"clarify",
	"plan",
	"generate",
	"test",
	"validate",
	"report",
];

export class PlannerAgent extends BaseAgent {
	constructor(
		model: import("../types").ModelEntry,
		api: import("../api/opencode").OpenCodeAPI,
	) {
		super("planner", model, api);
	}

	async analyzeTask(task: string): Promise<PipelineNode[]> {
		this.logger.info(`Planning: ${task.slice(0, 100)}`);
		const nodes = await this.selectNodes(task);
		this.logger.info(`Nodes: ${nodes.join(" -> ")}`);
		return nodes;
	}

	async selectNodes(task: string): Promise<PipelineNode[]> {
		const prompt = [
			"You select pipeline stages for a coding task.",
			"Available: clarify, plan, generate, test, validate, report.",
			"generate + report are mandatory. Others as needed.",
			"",
			`Task: ${task}`,
			"",
			"Return comma-separated node names:",
		].join("\n");

		const result = await this.think(prompt);
		const names = result.split(",").map((s) => s.trim().toLowerCase());
		const set = new Set<PipelineNode>();
		for (const n of names) {
			if ((ALL_NODES as readonly string[]).includes(n)) {
				set.add(n as PipelineNode);
			}
		}
		set.add("generate");
		set.add("report");
		return Array.from(set);
	}

	async replan(previousPlan: string, failureContext: string): Promise<string> {
		const prompt = [
			"The previous plan failed. Create an alternative plan.",
			"",
			`Previous plan: ${previousPlan}`,
			`Failure: ${failureContext}`,
			"",
			"Consider: different approach, simpler solution, smaller steps.",
		].join("\n");

		return this.think(prompt);
	}
}
