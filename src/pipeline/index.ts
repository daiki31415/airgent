/**
 * Pipeline Engine - DAG-based Execution
 *
 * Builds DAG from selected nodes and executes them in topological order.
 * Supports timeout enforcement and retry strategies.
 */

import type { DAGDefinition, DAGNode, PipelineNode, PipelineState, RetryContext, RetryDecision } from "../types";
import { rootLogger } from "../utils/logger";

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("timeout")), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer!));
}

const ALL_NODES: DAGNode[] = [
  { id: "clarify", dependsOn: [], handler: "clarify", maxRetries: 2, timeout: 30000 },
  { id: "plan", dependsOn: ["clarify"], handler: "plan", maxRetries: 2, timeout: 30000 },
  { id: "generate", dependsOn: ["plan"], handler: "generate", maxRetries: 3, timeout: 120000 },
  { id: "test", dependsOn: ["generate"], handler: "test", maxRetries: 2, timeout: 60000 },
  { id: "validate", dependsOn: ["test"], handler: "validate", maxRetries: 2, timeout: 30000 },
  { id: "report", dependsOn: ["validate"], handler: "report", maxRetries: 1, timeout: 15000 },
];

export class PipelineEngine {
  private states = new Map<string, PipelineState>();
  private handlers = new Map<PipelineNode, (input: unknown, retryCtx?: RetryContext) => Promise<unknown>>();
  private logger = rootLogger.child("pipeline");

  registerHandler(node: PipelineNode, handler: (input: unknown, retryCtx?: RetryContext) => Promise<unknown>): void {
    this.handlers.set(node, handler);
  }

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
    for (const node of dag.nodes) {
      if (state.completedNodes.includes(node.id)) continue;
      const result = await this.executeNode(state, node, results);
      results.set(node.id, result);
    }
    return results;
  }

  private async executeNode(
    state: PipelineState,
    node: DAGNode,
    results: Map<PipelineNode, unknown>,
  ): Promise<unknown> {
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

      const retryCtx: RetryContext | undefined =
        attempt > 0 ? { attempt, strategy: this.decideRetryStrategy(node, attempt, lastError!).strategy } : undefined;

      try {
        const result = await withTimeout(handler(results, retryCtx), node.timeout);
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

  return { nodes };
}
