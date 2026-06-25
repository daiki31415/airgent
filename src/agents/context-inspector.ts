/**
 * Context Inspector
 *
 * Long-running context corruption detection.
 * Tracks state across up to 20 previous inspections.
 */

import type { InspectionResult } from "../types";
import { BaseAgent } from "./base";

interface StateSnapshot {
	timestamp: number;
	focus: string;
	errors: string[];
	todos: string[];
	assumptions: string[];
}

export class ContextInspectorAgent extends BaseAgent {
	private previousStates: StateSnapshot[] = [];

	constructor(
		model: import("../types").ModelEntry,
		api: import("../api/opencode").OpenCodeAPI,
	) {
		super("context_inspector", model, api);
	}

	inspect(context: {
		currentFocus: string;
		errors: string[];
		todos: string[];
		messages: Array<{ role: string; content: string }>;
		assumptions?: string[];
	}): InspectionResult {
		const details: string[] = [];

		const current: StateSnapshot = {
			timestamp: Date.now(),
			focus: context.currentFocus,
			errors: context.errors || [],
			todos: context.todos || [],
			assumptions: context.assumptions || [],
		};

		const sameErrorRepeated = this.checkSameErrorRepeated(
			current.errors,
			details,
		);
		const purposeForgotten = this.checkPurposeForgotten(
			current.focus,
			context.messages,
			details,
		);
		const todoStuck = this.checkTodoStuck(current.todos, details);
		const assumptionFixed = this.checkAssumptionFixation(
			current.assumptions,
			details,
		);
		const errorChangeUnrecognized = this.checkErrorChangeUnrecognized(
			current.errors,
			details,
		);

		const result: InspectionResult = {
			sameErrorRepeated,
			purposeForgotten,
			todoStuck,
			assumptionFixed,
			errorChangeUnrecognized,
			details,
			score: 0,
		};
		result.score = this.calculateScore(result);

		this.previousStates.push(current);
		if (this.previousStates.length > 20) this.previousStates.shift();

		this.logger.info(
			`Inspection: score=${result.score.toFixed(2)}, issues=${result.details.length}`,
		);
		return result;
	}

	private checkSameErrorRepeated(
		_errors: string[],
		details: string[],
	): boolean {
		if (this.previousStates.length < 2) return false;
		const counts = new Map<string, number>();
		for (const state of this.previousStates) {
			for (const err of state.errors) {
				const key = err.slice(0, 50);
				counts.set(key, (counts.get(key) || 0) + 1);
			}
		}
		for (const [error, count] of counts) {
			if (count >= 3) {
				details.push(`Same error ${count}x: "${error}"`);
				return true;
			}
		}
		return false;
	}

	private checkPurposeForgotten(
		focus: string,
		messages: Array<{ role: string; content: string }>,
		details: string[],
	): boolean {
		if (messages.length < 5) return false;
		const first = messages.find((m) => m.role === "user");
		if (!first) return false;
		const original = first.content.slice(0, 100).toLowerCase();
		const currentFocus = focus.toLowerCase();
		const keywords = original.split(/\s+/).filter((w) => w.length > 4);
		const matched = keywords.filter((kw) => currentFocus.includes(kw));
		if (matched.length < Math.max(keywords.length * 0.3, 2)) {
			details.push(
				`Purpose drift: original="${original.slice(0, 80)}", focus="${focus.slice(0, 80)}"`,
			);
			return true;
		}
		return false;
	}

	private checkTodoStuck(todos: string[], details: string[]): boolean {
		if (this.previousStates.length < 3 || todos.length === 0) return false;
		const sigs = this.previousStates.map((s) =>
			s.todos.map((t) => t.slice(0, 40)).join("|"),
		);
		const currentSig = todos.map((t) => t.slice(0, 40)).join("|");
		if (sigs.filter((s) => s === currentSig).length >= 2) {
			details.push(`TODOs stuck: "${todos[0]?.slice(0, 80)}"`);
			return true;
		}
		return false;
	}

	private checkAssumptionFixation(
		assumptions: string[],
		details: string[],
	): boolean {
		if (this.previousStates.length < 3 || assumptions.length === 0)
			return false;
		for (const assumption of assumptions) {
			const count = this.previousStates.filter((s) =>
				s.assumptions.some((a) => a.includes(assumption.slice(0, 30))),
			).length;
			if (count >= 2) {
				details.push(`Assumption persisting: "${assumption}"`);
				return true;
			}
		}
		return false;
	}

	private checkErrorChangeUnrecognized(
		errors: string[],
		details: string[],
	): boolean {
		if (this.previousStates.length < 2) return false;
		const prev = this.previousStates[this.previousStates.length - 1];
		const prevErrors = prev?.errors || [];
		const oldSet = new Set(prevErrors.map((e) => e.slice(0, 60)));
		const newSet = new Set(errors.map((e) => e.slice(0, 60)));
		const added = [...newSet].filter((e) => !oldSet.has(e));
		const removed = [...oldSet].filter((e) => !newSet.has(e));
		if (added.length > 1 || removed.length > 1) {
			details.push(
				`Errors shifted: +${added.length} new, -${removed.length} resolved`,
			);
			return true;
		}
		return false;
	}

	private calculateScore(result: InspectionResult): number {
		let score = 0;
		if (result.sameErrorRepeated) score += 0.3;
		if (result.purposeForgotten) score += 0.2;
		if (result.todoStuck) score += 0.2;
		if (result.assumptionFixed) score += 0.15;
		if (result.errorChangeUnrecognized) score += 0.15;
		return Math.min(score, 1.0);
	}

	async suggestRemediation(result: InspectionResult): Promise<string> {
		if (result.score < 0.3) return "No remediation needed.";
		const issues: string[] = [];
		if (result.sameErrorRepeated) issues.push("- Same error repeated");
		if (result.purposeForgotten) issues.push("- Task drift");
		if (result.todoStuck) issues.push("- TODOs stuck");
		if (result.assumptionFixed) issues.push("- Assumptions fixed");
		if (result.errorChangeUnrecognized) issues.push("- Error context shifted");
		const prompt = ["Analyze and suggest remediation:", "", ...issues].join(
			"\n",
		);
		return this.think(prompt);
	}
}
