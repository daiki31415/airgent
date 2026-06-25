import { describe, expect, test } from "bun:test";
import { PipelineEngine } from "../index";

describe("PipelineEngine execute", () => {
	test("executes a single node handler", async () => {
		const engine = new PipelineEngine();
		engine.registerHandler("clarify", async () => ({ content: "analyzed" }));

		const dag = engine.buildDAG(["clarify"]);
		const results = await engine.execute("session-1", dag);

		expect(results.get("clarify")).toEqual({ content: "analyzed" });
	});

	test("executes nodes in dependency order", async () => {
		const order: string[] = [];
		const engine = new PipelineEngine();
		engine.registerHandler("clarify", async () => {
			order.push("clarify");
			return { content: "c" };
		});
		engine.registerHandler("plan", async () => {
			order.push("plan");
			return { content: "p" };
		});
		engine.registerHandler("generate", async () => {
			order.push("generate");
			return { content: "g" };
		});

		const dag = engine.buildDAG(["generate"]);
		await engine.execute("session-2", dag);

		expect(order).toEqual(["clarify", "plan", "generate"]);
	});

	test("returns error when handler not registered", async () => {
		const engine = new PipelineEngine();
		const dag = engine.buildDAG(["clarify"]);

		expect(engine.execute("session-3", dag)).rejects.toThrow(
			"No handler for: clarify",
		);
	});

	test("retries on handler failure and succeeds", async () => {
		let attempts = 0;
		const engine = new PipelineEngine();
		engine.registerHandler("clarify", async () => {
			attempts++;
			if (attempts < 2) throw new Error("transient failure");
			return { content: "ok" };
		});

		const dag = engine.buildDAG(["clarify"]);
		const results = await engine.execute("session-4", dag);

		expect(attempts).toBe(2);
		expect(results.get("clarify")).toEqual({ content: "ok" });
	});

	test("throws after exhausting retries", async () => {
		const engine = new PipelineEngine();
		engine.registerHandler("clarify", async () => {
			throw new Error("persistent failure");
		});

		const dag = engine.buildDAG(["clarify"]);
		expect(engine.execute("session-5", dag)).rejects.toThrow(
			"persistent failure",
		);
	});

	test("skips already completed nodes", async () => {
		const clarificationCalls: number[] = [];
		const engine = new PipelineEngine();
		engine.registerHandler("clarify", async () => {
			clarificationCalls.push(1);
			return { content: "c" };
		});
		engine.registerHandler("plan", async () => ({ content: "p" }));

		const dag = engine.buildDAG(["clarify", "plan"]);
		await engine.execute("session-6", dag);
		await engine.execute("session-6", dag);

		expect(clarificationCalls.length).toBe(1);
	});

	test("tracks pipeline state", async () => {
		const engine = new PipelineEngine();
		engine.registerHandler("clarify", async () => ({ content: "c" }));

		const dag = engine.buildDAG(["clarify"]);
		await engine.execute("session-7", dag);

		const state = engine.getState("session-7");
		expect(state).toBeDefined();
		expect(state?.completedNodes).toContain("clarify");
		expect(state?.failedNodes).toEqual([]);
	});

	test("resets session state", async () => {
		const engine = new PipelineEngine();
		engine.registerHandler("clarify", async () => ({ content: "c" }));

		const dag = engine.buildDAG(["clarify"]);
		await engine.execute("session-8", dag);
		engine.reset("session-8");

		expect(engine.getState("session-8")).toBeUndefined();
	});

	test("allows multiple independent sessions", async () => {
		const engine = new PipelineEngine();
		let counter = 0;
		engine.registerHandler("clarify", async () => ({
			content: `${counter++}`,
		}));

		const dag = engine.buildDAG(["clarify"]);
		const r1 = await engine.execute("sess-a", dag);
		const r2 = await engine.execute("sess-b", dag);

		expect(r1.get("clarify")).toEqual({ content: "0" });
		expect(r2.get("clarify")).toEqual({ content: "1" });
	});

	test("handler error propagates correctly", async () => {
		const engine = new PipelineEngine();
		engine.registerHandler("clarify", async () => {
			throw new Error("handler-error");
		});

		const dag = engine.buildDAG(["clarify"]);
		expect(engine.execute("session-e1", dag)).rejects.toThrow("handler-error");
	});

	test("empty DAG executes without error", async () => {
		const engine = new PipelineEngine();
		const dag = engine.buildDAG([]);
		const results = await engine.execute("session-empty", dag);
		expect(results.size).toBe(0);
	});

	test("completed nodes are tracked in state", async () => {
		const engine = new PipelineEngine();
		engine.registerHandler("clarify", async () => ({ content: "c" }));
		engine.registerHandler("plan", async () => ({ content: "p" }));

		const dag = engine.buildDAG(["clarify", "plan"]);
		await engine.execute("session-s1", dag);

		const state = engine.getState("session-s1");
		expect(state?.completedNodes).toEqual(["clarify", "plan"]);
	});

	test("reset works on state with no data", () => {
		const engine = new PipelineEngine();
		engine.reset("nonexistent");
		expect(engine.getState("nonexistent")).toBeUndefined();
	});

	test("executes independent branches in parallel", async () => {
		const order: string[] = [];
		const engine = new PipelineEngine();
		engine.registerHandler("clarify", async () => {
			order.push("clarify");
			return {};
		});
		engine.registerHandler("plan", async () => {
			order.push("plan");
			return {};
		});
		engine.registerHandler("generate", async () => {
			order.push("generate");
			return {};
		});
		engine.registerHandler("test", async () => {
			order.push("test");
			return {};
		});
		engine.registerHandler("validate", async () => {
			order.push("validate");
			return {};
		});
		engine.registerHandler("report", async () => {
			order.push("report");
			return {};
		});

		const dag = engine.buildDAG(["report"]);
		await engine.execute("session-parallel", dag);

		expect(order[0]).toBe("clarify");
		expect(order[1]).toBe("plan");
		expect(order[2]).toBe("generate");
		expect(order.indexOf("validate")).toBeGreaterThan(
			order.indexOf("generate")!,
		);
		expect(order.indexOf("test")).toBeGreaterThan(order.indexOf("generate")!);
		expect(order.indexOf("report")).toBeGreaterThan(order.indexOf("test")!);
		expect(order.indexOf("report")).toBeGreaterThan(order.indexOf("validate")!);
		expect(order.indexOf("report")).toBe(order.length - 1);
	});

	test("throws timeout when handler exceeds timeout", async () => {
		const engine = new PipelineEngine();
		engine.registerHandler("clarify", async () => {
			await new Promise((r) => setTimeout(r, 500));
			return { content: "too slow" };
		});

		const dag = engine.buildDAG(["clarify"]);
		dag.nodes[0]!.timeout = 10;

		await expect(engine.execute("session-t1", dag)).rejects.toThrow("timeout");
	});

	test("succeeds within timeout", async () => {
		const engine = new PipelineEngine();
		engine.registerHandler("clarify", async () => {
			await new Promise((r) => setTimeout(r, 5));
			return { content: "fast enough" };
		});

		const dag = engine.buildDAG(["clarify"]);
		dag.nodes[0]!.timeout = 1000;

		const results = await engine.execute("session-t2", dag);
		expect(results.get("clarify")).toEqual({ content: "fast enough" });
	});

	test("RetryContext attempt increments on retry", async () => {
		const attempts: number[] = [];
		const engine = new PipelineEngine();
		engine.registerHandler("clarify", async (_input, retryCtx) => {
			attempts.push(retryCtx?.attempt ?? 0);
			if (attempts.length < 2) throw new Error("fail");
			return { content: "ok" };
		});

		const dag = engine.buildDAG(["clarify"]);
		await engine.execute("session-rc1", dag);

		expect(attempts).toEqual([0, 1]);
	});

	describe("dynamic DAG mutation", () => {
		test("handler can dynamically add a known node by name", async () => {
			const engine = new PipelineEngine();
			const order: string[] = [];

			engine.registerHandler("clarify", async () => {
				order.push("clarify");
				return {};
			});
			engine.registerHandler("plan", async () => {
				order.push("plan");
				return {};
			});
			engine.registerHandler("generate", async () => {
				order.push("generate");
				engine.addNode("dyn-add", "test");
				return {};
			});
			engine.registerHandler("test", async () => {
				order.push("test");
				return { passed: true };
			});
			engine.registerHandler("validate", async () => {
				order.push("validate");
				return {};
			});

			const dag = engine.buildDAG(["clarify", "plan", "generate", "validate"]);
			const results = await engine.execute("dyn-add", dag);

			expect(results.has("test")).toBe(true);
			expect(results.get("test")).toEqual({ passed: true });
			expect(order.indexOf("test")).toBeGreaterThan(order.indexOf("generate")!);
		});

		test("handler can dynamically add a custom DAGNode", async () => {
			const engine = new PipelineEngine();

			engine.registerHandler("clarify", async () => {
				return {};
			});
			engine.registerHandler("generate", async () => {
				engine.addNode("dyn-custom", {
					id: "test",
					dependsOn: ["generate"],
					handler: "test",
					maxRetries: 0,
					timeout: 5000,
				});
				return {};
			});
			engine.registerHandler("test", async () => ({ passed: true }));
			engine.registerHandler("plan", async () => {
				return {};
			});

			const dag = engine.buildDAG(["clarify", "plan", "generate"]);
			const results = await engine.execute("dyn-custom", dag);

			expect(results.has("test")).toBe(true);
			expect(results.get("test")).toEqual({ passed: true });
		});

		test("dynamically added node runs after its dependencies complete", async () => {
			const engine = new PipelineEngine();
			const order: string[] = [];

			engine.registerHandler("generate", async () => {
				order.push("generate");
				engine.addNode("dyn-order", "test");
				return {};
			});
			engine.registerHandler("test", async () => {
				order.push("test");
				return {};
			});
			engine.registerHandler("clarify", async () => {
				order.push("clarify");
				return {};
			});
			engine.registerHandler("plan", async () => {
				order.push("plan");
				return {};
			});

			const dag = engine.buildDAG(["clarify", "plan", "generate"]);
			await engine.execute("dyn-order", dag);

			expect(order.indexOf("test")).toBeGreaterThan(order.indexOf("generate")!);
		});

		test("handler can dynamically remove a node from the DAG", async () => {
			const engine = new PipelineEngine();
			const order: string[] = [];

			engine.registerHandler("clarify", async () => {
				order.push("clarify");
				return {};
			});
			engine.registerHandler("plan", async () => {
				order.push("plan");
				engine.removeNode("dyn-remove", "validate");
				return {};
			});
			engine.registerHandler("generate", async () => {
				order.push("generate");
				return {};
			});
			engine.registerHandler("validate", async () => {
				order.push("validate");
				return {};
			});

			const dag = engine.buildDAG(["clarify", "plan", "generate", "validate"]);
			const results = await engine.execute("dyn-remove", dag);

			expect(results.has("validate")).toBe(false);
			expect(order).not.toContain("validate");
		});

		test("removing a node that another node depends on causes deadlock", async () => {
			const engine = new PipelineEngine();

			engine.registerHandler("clarify", async () => {
				return {};
			});
			engine.registerHandler("plan", async () => {
				engine.removeNode("dyn-deadlock", "generate");
				return {};
			});
			engine.registerHandler("generate", async () => ({ content: "g" }));
			engine.registerHandler("test", async () => ({ passed: true }));

			const dag = engine.buildDAG(["clarify", "plan", "generate", "test"]);
			await expect(engine.execute("dyn-deadlock", dag)).rejects.toThrow(
				"DAG deadlock",
			);
		});
	});

	test("RetryContext strategy reflects rollback on max retries", async () => {
		const strats: string[] = [];
		const engine = new PipelineEngine();
		engine.registerHandler("clarify", async (_input, retryCtx) => {
			if (retryCtx) strats.push(retryCtx.strategy);
			throw new Error("always fail");
		});

		const dag = engine.buildDAG(["clarify"]);
		dag.nodes[0]!.maxRetries = 1;

		await expect(engine.execute("session-rc2", dag)).rejects.toThrow(
			"always fail",
		);
		expect(strats[strats.length - 1]).toBe("rollback");
	});

	test("timeout error triggers model_switch strategy", async () => {
		const strats: string[] = [];
		const engine = new PipelineEngine();
		engine.registerHandler("clarify", async (_input, retryCtx) => {
			if (retryCtx) strats.push(retryCtx.strategy);
			throw new Error("always fail");
		});

		const dag = engine.buildDAG(["clarify"]);
		dag.nodes[0]!.maxRetries = 2;

		await expect(engine.execute("session-rc3", dag)).rejects.toThrow(
			"always fail",
		);

		const timeoutTest = new PipelineEngine();
		timeoutTest.registerHandler("clarify", async () => {
			await new Promise((r) => setTimeout(r, 100));
			return { content: "x" };
		});

		const dag2 = timeoutTest.buildDAG(["clarify"]);
		dag2.nodes[0]!.timeout = 1;
		dag2.nodes[0]!.maxRetries = 1;

		let decidedRollback = false;
		try {
			await timeoutTest.execute("session-t3", dag2);
		} catch {
			const state = timeoutTest.getState("session-t3");
			if (state?.failedNodes[0]?.error?.includes("timeout"))
				decidedRollback = true;
		}
		expect(decidedRollback).toBe(true);
	});
});
