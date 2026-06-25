/**
 * Pipeline Engine - DAG-based Execution
 *
 * Builds DAG from selected nodes and executes them in topological order.
 * Supports timeout enforcement and retry strategies.
 * All nodes are registered at the instance level for dynamic registration/unregistration.
 */

import type {
	DAGDefinition,
	DAGNode,
	PipelineState,
	RetryContext,
	RetryDecision,
} from "../types";
import { rootLogger } from "../utils/logger";

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
	let timer: ReturnType<typeof setTimeout>;
	const timeout = new Promise<never>((_, reject) => {
		timer = setTimeout(() => reject(new Error("timeout")), timeoutMs);
	});
	return Promise.race([promise, timeout]).finally(() => clearTimeout(timer!));
}

const DEFAULT_NODES: DAGNode[] = [
	{
		id: "clarify",
		dependsOn: [],
		handler: "clarify",
		maxRetries: 2,
		timeout: 30000,
	},
	{
		id: "plan",
		dependsOn: ["clarify"],
		handler: "plan",
		maxRetries: 2,
		timeout: 30000,
	},
	{
		id: "generate",
		dependsOn: ["plan"],
		handler: "generate",
		maxRetries: 3,
		timeout: 120000,
	},
	{
		id: "test",
		dependsOn: ["generate"],
		handler: "test",
		maxRetries: 2,
		timeout: 60000,
	},
	{
		id: "validate",
		dependsOn: ["generate"],
		handler: "validate",
		maxRetries: 2,
		timeout: 30000,
	},
	{
		id: "report",
		dependsOn: ["test", "validate"],
		handler: "report",
		maxRetries: 1,
		timeout: 15000,
	},
];

export class PipelineEngine {
	private states = new Map<string, PipelineState>();
	private handlers = new Map<
		string,
		(input: unknown, retryCtx?: RetryContext) => Promise<unknown>
	>();
	private logger = rootLogger.child("pipeline");
	nodes = new Map<string, DAGNode>();

	constructor() {
		for (const node of DEFAULT_NODES) {
			this.nodes.set(node.id, node);
		}
	}

	registerNode(name: string, node: DAGNode): void {
		this.nodes.set(name, node);
	}

	unregisterNode(name: string): void {
		this.nodes.delete(name);
	}

	registerHandler(
		id: string,
		handler: (input: unknown, retryCtx?: RetryContext) => Promise<unknown>,
	): void {
		this.handlers.set(id, handler);
	}

	buildDAG(selectedNodes: string[]): DAGDefinition {
		const nodes: DAGNode[] = [];
		const resolved = new Set<string>();
		const nodeMap = this.nodes;

		const resolve = (id: string) => {
			if (resolved.has(id)) return;
			const node = nodeMap.get(id);
			if (!node) return;
			for (const dep of node.dependsOn) resolve(dep);
			resolved.add(id);
			nodes.push({ ...node });
		};

		for (const id of selectedNodes) resolve(id);

		return { nodes };
	}

	async execute(
		sessionId: string,
		dag: DAGDefinition,
	): Promise<Map<string, unknown>> {
		let state = this.states.get(sessionId);
		if (!state) {
			state = {
				sessionId,
				currentNode: null,
				completedNodes: [],
				failedNodes: [],
				retryCounts: {},
				startTime: Date.now(),
				dagNodes: [],
			};
			this.states.set(sessionId, state);
		}

		state.dagNodes = [...dag.nodes];

		this.logger.info(
			`Executing DAG: ${dag.nodes.map((n) => n.id).join(" -> ")}`,
		);

		const results = new Map<string, unknown>();

		while (true) {
			const remaining = state.dagNodes.filter(
				(n) => !state.completedNodes.includes(n.id) && !results.has(n.id),
			);
			if (remaining.length === 0) break;

			const ready = remaining.filter((n) =>
				n.dependsOn.every(
					(dep) => results.has(dep) || state.completedNodes.includes(dep),
				),
			);

			if (ready.length === 0) {
				throw new Error(
					`DAG deadlock: cannot resolve ${remaining.map((n) => n.id).join(", ")}`,
				);
			}

			const batch = await Promise.all(
				ready.map(async (node) => {
					const result = await this.executeNode(state, node, results);
					return { id: node.id, result };
				}),
			);

			for (const { id, result } of batch) {
				results.set(id, result);
			}
		}

		return results;
	}

	private async executeNode(
		state: PipelineState,
		node: DAGNode,
		results: Map<string, unknown>,
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
				attempt > 0
					? {
							attempt,
							strategy: this.decideRetryStrategy(node, attempt, lastError!)
								.strategy,
						}
					: undefined;

			try {
				const result = await withTimeout(
					handler(results, retryCtx),
					node.timeout,
				);
				state.completedNodes.push(node.id);
				this.logger.info(`Completed: ${node.id}`);
				return result;
			} catch (err) {
				lastError = err instanceof Error ? err : new Error(String(err));
			}

			const strategy = this.decideRetryStrategy(node, attempt, lastError);
			if (strategy.strategy === "rollback") break;
		}

		state.failedNodes.push({
			node: node.id,
			error: lastError?.message || "Unknown",
		});
		throw lastError || new Error(`Node ${node.id} failed`);
	}

	private decideRetryStrategy(
		node: DAGNode,
		attempt: number,
		error: Error | null,
	): RetryDecision {
		if (attempt >= node.maxRetries)
			return { strategy: "rollback", reason: "Max retries" };
		if (
			error?.message?.includes("timeout") ||
			error?.message?.includes("rate limit")
		) {
			return { strategy: "model_switch", reason: "Rate limit/timeout" };
		}
		if (attempt > 1)
			return { strategy: "alternate_strategy", reason: "Repeated failure" };
		return { strategy: "retry", reason: "Transient" };
	}

	getState(sessionId: string): PipelineState | undefined {
		return this.states.get(sessionId);
	}

	reset(sessionId: string): void {
		this.states.delete(sessionId);
	}

	addNode(sessionId: string, idOrNode: string | DAGNode): void {
		const state = this.states.get(sessionId);
		if (!state) return;

		if (typeof idOrNode === "string") {
			this.addNodeWithDeps(state, idOrNode);
		} else {
			if (!state.dagNodes.find((n) => n.id === idOrNode.id)) {
				state.dagNodes.push(idOrNode);
			}
		}
	}

	removeNode(sessionId: string, id: string): void {
		const state = this.states.get(sessionId);
		if (!state) return;
		const idx = state.dagNodes.findIndex((n) => n.id === id);
		if (idx >= 0) state.dagNodes.splice(idx, 1);
	}

	private addNodeWithDeps(state: PipelineState, id: string): void {
		if (
			state.dagNodes.find((n) => n.id === id) ||
			state.completedNodes.includes(id)
		)
			return;

		const node = this.nodes.get(id);
		if (!node) throw new Error(`Unknown node: ${id}`);

		for (const dep of node.dependsOn) {
			this.addNodeWithDeps(state, dep);
		}

		state.dagNodes.push({ ...node });
	}
}
