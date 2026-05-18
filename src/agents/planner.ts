/**
 * Planner Agent
 *
 * Responsibility: Task decomposition and pipeline node selection.
 * Rules-based node selector with task analysis.
 */

import { BaseAgent } from "./base";
import type { PipelineNode } from "../types";
import { buildDAG } from "../pipeline";

const ALL_NODES: PipelineNode[] = ["clarify", "plan", "prompt", "generate", "test", "merge", "validate", "report"];

export class PlannerAgent extends BaseAgent {
  constructor(model: import("../types").ModelEntry, api: import("../api/opencode").OpenCodeAPI) {
    super("planner", model, api);
  }

  /**
   * Analyze a user request and return selected pipeline nodes.
   */
  analyzeTask(task: string): PipelineNode[] {
    this.logger.info(`Planning: ${task.slice(0, 100)}`);
    const nodes = this.selectNodes(task);
    this.logger.info(`Nodes: ${nodes.join(" -> ")}`);
    return nodes;
  }

  selectNodes(task: string): PipelineNode[] {
    const lower = task.toLowerCase();
    const set = new Set<PipelineNode>();

    set.add("clarify");
    set.add("plan");

    if (/code|implement|function|class|fix|refactor|feature|write/.test(lower)) {
      set.add("prompt");
      set.add("generate");
      set.add("test");
    }

    if (/merge|combine|integrate|branch/.test(lower)) {
      set.add("merge");
    }

    if (/review|validate|check|audit/.test(lower)) {
      set.add("validate");
    }

    set.add("report");
    return Array.from(set);
  }

  /**
   * Re-plan based on failure feedback.
   */
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
