/**
 * Pipeline Engine - DAG-based Execution
 *
 * Builds DAG from selected nodes and executes them.
 * All 8 node types with dependency resolution.
 */

import type { DAGDefinition, DAGNode, PipelineNode, PipelineState, RetryDecision } from "../types";
import { rootLogger } from "../utils/logger";

const ALL_NODES: DAGNode[] = [
  { id: "clarify", dependsOn: [], handler: "clarify", maxRetries: 2, timeout: 30000 },
  { id: "plan", dependsOn: ["clarify"], handler: "plan", maxRetries: 2, timeout: 30000 },
  { id: "prompt", dependsOn: ["plan"], handler: "prompt", maxRetries: 2, timeout: 15000 },
  { id: "generate", dependsOn: ["prompt"], handler: "generate", maxRetries: 3, timeout: 120000 },
  { id: "test", dependsOn: ["generate"], handler: "test", maxRetries: 2, timeout: 60000 },
  { id: "merge", dependsOn: ["test"], handler: "merge", maxRetries: 2, timeout: 15000 },
  { id: "validate", dependsOn: ["merge"], handler: "validate", maxRetries: 2, timeout: 30000 },
  { id: "report", dependsOn: ["validate"], handler: "report", maxRetries: 1, timeout: 15000 },
];

export class PipelineEngine {
  private states = new Map<string, PipelineState>();
  private handlers = new Map<PipelineNode, (input: unknown) => Promise<unknown>>();
  private logger = rootLogger.child("pipeline");

  /**
   * Register a handler for a pipeline node type.
   */
  registerHandler(node: PipelineNode, handler: (input: unknown) => Promise<unknown>): void {
    this.handlers.set(node, handler);
  }

  /**
   * Execute a DAG definition for a session.
   */
  async execute(sessionId: string, dag: DAGDefinition): Promise<Map<PipelineNode, unknown>> {
    let state = this.states.get(sessionId);
    if (!state) {
      state = {
        sessionId,
        currentNode: null,
        completedNodes: [],
        failedNodes: [],
        retryCounts: {},
        startTime: Date.now(),
      };
      this.states.set(sessionId, state);
    }

    this.logger.info(`Executing: ${dag.nodes.map(n => n.id).join(" -> ")}`);

    const results = new Map<PipelineNode, unknown>();
    await this.executeNodes(state, dag.nodes, new Set(), results);
    return results;
  }

  private async executeNodes(state: PipelineState, nodes: DAGNode[], visited: Set<string>, results: Map<PipelineNode, unknown>): Promise<void> {
    for (const node of nodes) {
      if (state.completedNodes.includes(node.id)) continue;
      if (visited.has(node.id)) {
        this.logger.warn(`Circular: ${node.id}`);
        continue;
      }

      if (node.dependsOn.length > 0) {
        const deps = nodes.filter(n => node.dependsOn.includes(n.id));
        await this.executeNodes(state, deps, new Set(visited), results);
      }

      const result = await this.executeNode(state, node);
      results.set(node.id, result);
    }
  }

  private async executeNode(state: PipelineState, node: DAGNode): Promise<unknown> {
    state.currentNode = node.id;
    this.logger.info(`Executing: ${node.id}`);

    const handler = this.handlers.get(node.id);
    if (!handler) throw new Error(`No handler for: ${node.id}`);

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= node.maxRetries; attempt++) {
      if (attempt > 0) {
        this.logger.warn(`Retry ${attempt}/${node.maxRetries}: ${node.id}`);
        state.retryCounts[node.id] = attempt;
      }

      try {
        const result = await handler({});
        state.completedNodes.push(node.id);
        this.logger.info(`Completed: ${node.id}`);
        return result;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
      }

      const strategy = this.decideRetryStrategy(node, attempt, lastError);
      if (strategy.strategy === "rollback") break;
    }

    state.failedNodes.push({ node: node.id, error: lastError?.message || "Unknown" });
    throw lastError || new Error(`Node ${node.id} failed`);
  }

  private decideRetryStrategy(node: DAGNode, attempt: number, error: Error | null): RetryDecision {
    if (attempt >= node.maxRetries) return { strategy: "rollback", reason: "Max retries" };
    if (error?.message?.includes("timeout") || error?.message?.includes("rate limit")) {
      return { strategy: "model_switch", reason: "Rate limit/timeout" };
    }
    if (attempt > 1) return { strategy: "alternate_strategy", reason: "Repeated failure" };
    return { strategy: "retry", reason: "Transient" };
  }

  getState(sessionId: string): PipelineState | undefined {
    return this.states.get(sessionId);
  }

  reset(sessionId: string): void {
    this.states.delete(sessionId);
  }
}

/**
 * Build a DAG definition from a set of selected pipeline nodes.
 * Resolves full dependency chains.
 */
export function buildDAG(selectedNodes: PipelineNode[]): DAGDefinition {
  const nodeMap = new Map(ALL_NODES.map(n => [n.id, n]));
  const nodes: DAGNode[] = [];
  const resolved = new Set<PipelineNode>();

  function resolve(id: PipelineNode): void {
    if (resolved.has(id)) return;
    const node = nodeMap.get(id);
    if (!node) return;
    for (const dep of node.dependsOn) resolve(dep);
    resolved.add(id);
    nodes.push(node);
  }

  for (const id of selectedNodes) resolve(id);

  return {
    nodes,
    entryPoints: nodes.filter(n => n.dependsOn.length === 0).map(n => n.id),
  };
}
