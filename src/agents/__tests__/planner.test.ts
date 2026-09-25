/**
 * Tests for PlannerAgent.
 *
 * PlannerAgent extends BaseAgent and uses this.think() (which calls api.chat)
 * to select pipeline nodes.
 */

import { describe, expect, mock, test } from "bun:test";
import { OpenCodeAPI } from "../../api/opencode";
import type { AgentContext, ModelEntry, OpenCodeResponse } from "../../types";
import { PlannerAgent } from "../planner";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockModel(): ModelEntry {
	return { provider: "test", model: "test-model" };
}

function createApi(responseContent: string): OpenCodeAPI {
	const api = new (class extends OpenCodeAPI {
		override chat = mock(
			async (
				_model: ModelEntry,
				_messages: Array<{ role: string; content: string }>,
			): Promise<OpenCodeResponse> => {
				return {
					id: "planner-resp",
					content: responseContent,
					model: "test/model",
					usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
				};
			},
		);
		override streamChat = mock(async function* (): AsyncGenerator<string> {});
	})();
	return api;
}

function sampleContext(overrides?: Partial<AgentContext>): AgentContext {
	return {
		sessionId: "planner-session",
		messages: [],
		systemPrompt: "You are a planning assistant.",
		skillIndex: { skills: [] },
		activeSkills: [],
		memory: { relevantMemories: [], recentRawLogs: [], compressedEntries: [] },
		state: {},
		tokenCount: 0,
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("PlannerAgent.constructor", () => {
	test("sets role to planner", () => {
		const agent = new PlannerAgent(mockModel(), createApi(""));
		expect(agent.role).toBe("planner");
	});

	test("stores model parameter", () => {
		const model = mockModel();
		const agent = new PlannerAgent(model, createApi(""));
		expect(agent.getModel()).toEqual(model);
	});
});

describe("PlannerAgent.init", () => {
	test("stores context", () => {
		const agent = new PlannerAgent(mockModel(), createApi(""));
		const ctx = sampleContext();
		agent.init(ctx);
		expect(agent.getContext()).not.toBeNull();
		expect(agent.getContext()?.sessionId).toBe("planner-session");
	});
});

describe("PlannerAgent.selectNodes", () => {
	test("returns generate and report always even when LLM omits them", async () => {
		const agent = new PlannerAgent(mockModel(), createApi("clarify, plan, test, validate"));
		agent.init(sampleContext());

		const nodes = await agent.selectNodes("some task");
		expect(nodes).toContain("generate");
		expect(nodes).toContain("report");
		expect(nodes).toContain("clarify");
	});

	test("parses comma-separated response", async () => {
		const agent = new PlannerAgent(
			mockModel(),
			createApi("clarify, plan, generate, test, validate, report"),
		);
		agent.init(sampleContext());

		const nodes = await agent.selectNodes("build login");
		expect(nodes).toHaveLength(6);
		expect(nodes).toEqual(["clarify", "plan", "generate", "test", "validate", "report"]);
	});

	test("handles spaces around commas", async () => {
		const agent = new PlannerAgent(mockModel(), createApi("  clarify ,   plan , generate "));
		agent.init(sampleContext());

		const nodes = await agent.selectNodes("task");
		expect(nodes).toContain("clarify");
		expect(nodes).toContain("plan");
		// generate + report are always added
		expect(nodes.every((n) => ["clarify", "plan", "generate", "report"].includes(n)));
	});

	test("deduplicates nodes", async () => {
		const agent = new PlannerAgent(mockModel(), createApi("generate, generate, plan, generate"));
		agent.init(sampleContext());

		const nodes = await agent.selectNodes("task");
		const generateCount = nodes.filter((n) => n === "generate").length;
		expect(generateCount).toBe(1);
	});

	test("filters out invalid node names", async () => {
		const agent = new PlannerAgent(mockModel(), createApi("clarify, invalid, garbage, plan"));
		agent.init(sampleContext());

		const nodes = await agent.selectNodes("task");
		expect(nodes).not.toContain("invalid");
		expect(nodes).not.toContain("garbage");
		expect(nodes).toContain("clarify");
		expect(nodes).toContain("plan");
	});

	test("lowercases all node names", async () => {
		const agent = new PlannerAgent(mockModel(), createApi("CLARIFY, PLAN, GENERATE"));
		agent.init(sampleContext());

		const nodes = await agent.selectNodes("task");
		expect(nodes).toContain("clarify");
		expect(nodes).toContain("plan");
	});

	test("returns all-uppercase nodes correctly", async () => {
		const agent = new PlannerAgent(mockModel(), createApi("VALIDATE, TEST"));
		agent.init(sampleContext());

		const nodes = await agent.selectNodes("task");
		expect(nodes).toContain("validate");
		expect(nodes).toContain("test");
	});

	test("handles response with only generate", async () => {
		const agent = new PlannerAgent(mockModel(), createApi("generate"));
		agent.init(sampleContext());

		const nodes = await agent.selectNodes("simple task");
		expect(nodes).toEqual(["generate", "report"]);
	});

	test("handles duplicate entries plus mandatory adds", async () => {
		const agent = new PlannerAgent(mockModel(), createApi("generate, report"));
		agent.init(sampleContext());

		const nodes = await agent.selectNodes("task");
		expect(nodes).toHaveLength(2);
		expect(nodes).toContain("generate");
		expect(nodes).toContain("report");
	});

	test("empty LLM response falls back to generate+report", async () => {
		const agent = new PlannerAgent(mockModel(), createApi(""));
		agent.init(sampleContext());

		const nodes = await agent.selectNodes("task");
		expect(nodes).toEqual(["generate", "report"]);
	});

	test("LLM response with only invalid nodes returns generate+report", async () => {
		const agent = new PlannerAgent(mockModel(), createApi("badnode, wrong"));
		agent.init(sampleContext());

		const nodes = await agent.selectNodes("task");
		expect(nodes).toEqual(["generate", "report"]);
	});

	test("calls think with correct prompt", async () => {
		const api = createApi("plan, generate, report");
		const agent = new PlannerAgent(mockModel(), api);
		agent.init(sampleContext());

		await agent.selectNodes("my task description");

		expect(api.chat).toHaveBeenCalledTimes(1);
		// biome-ignore lint/suspicious/noExplicitAny: accessing mock internals from bun:test
		const callArgs = (api.chat as any).mock.calls[0];
		const promptText = callArgs[1][1].content;
		expect(promptText).toContain("my task description");
		expect(promptText).toContain("clarify, plan, generate, test, validate, report");
	});

	test("selectNodes with partial match returns valid subset", async () => {
		const agent = new PlannerAgent(mockModel(), createApi("plan, validate"));
		agent.init(sampleContext());

		const nodes = await agent.selectNodes("task");
		// plan + validate from LLM, generate + report always added
		expect(nodes).toContain("plan");
		expect(nodes).toContain("validate");
		expect(nodes).toContain("generate");
		expect(nodes).toContain("report");
	});
});

describe("PlannerAgent.analyzeTask", () => {
	test("returns PipelineNode[] from selectNodes", async () => {
		const agent = new PlannerAgent(mockModel(), createApi("plan, generate, test, report"));
		agent.init(sampleContext());

		const nodes = await agent.analyzeTask("build feature X");
		expect(Array.isArray(nodes)).toBe(true);
		expect(nodes.length).toBeGreaterThanOrEqual(2);
	});

	test("includes generate in result", async () => {
		const agent = new PlannerAgent(mockModel(), createApi("clarify, plan"));
		agent.init(sampleContext());

		const nodes = await agent.analyzeTask("task");
		expect(nodes).toContain("generate");
	});

	test("includes report in result", async () => {
		const agent = new PlannerAgent(mockModel(), createApi("clarify, plan"));
		agent.init(sampleContext());

		const nodes = await agent.analyzeTask("task");
		expect(nodes).toContain("report");
	});

	test("returns ordered list matching LLM selection plus mandatory", async () => {
		const agent = new PlannerAgent(mockModel(), createApi("plan, test, generate, report"));
		agent.init(sampleContext());

		const nodes = await agent.analyzeTask("task");
		// Order is preserved from Set iteration
		expect(nodes[0]).toBe("plan");
		expect(nodes[1]).toBe("test");
	});

	test("handles very long task description", async () => {
		const longTask = "a".repeat(10000);
		const agent = new PlannerAgent(mockModel(), createApi("plan, generate, report"));
		agent.init(sampleContext());

		const nodes = await agent.analyzeTask(longTask);
		expect(nodes).toContain("generate");
		expect(nodes).toContain("report");
	});

	test("handles task description with special characters", async () => {
		const agent = new PlannerAgent(mockModel(), createApi("plan, generate, report"));
		agent.init(sampleContext());

		const nodes = await agent.analyzeTask(
			"Fix #123: TypeError in <Component /> & process.env.API_KEY",
		);
		expect(nodes).toContain("generate");
	});
});

describe("PlannerAgent.replan", () => {
	test("returns string from think()", async () => {
		const api = createApi("alternate approach: use a different library");
		const agent = new PlannerAgent(mockModel(), api);
		agent.init(sampleContext());

		const result = await agent.replan("original plan", "failure context");
		expect(typeof result).toBe("string");
		expect(result).toContain("alternate approach");
	});

	test("includes previous plan and failure in prompt", async () => {
		const api = createApi("new plan");
		const agent = new PlannerAgent(mockModel(), api);
		agent.init(sampleContext());

		await agent.replan("old plan", "error occurred");

		// biome-ignore lint/suspicious/noExplicitAny: accessing mock internals from bun:test
		const callArgs = (api.chat as any).mock.calls[0];
		const promptText = callArgs[1][1].content;
		expect(promptText).toContain("old plan");
		expect(promptText).toContain("error occurred");
	});

	test("handles empty previous plan", async () => {
		const api = createApi("new plan");
		const agent = new PlannerAgent(mockModel(), api);
		agent.init(sampleContext());

		const result = await agent.replan("", "failure");
		expect(typeof result).toBe("string");
	});

	test("handles empty failure context", async () => {
		const api = createApi("new plan");
		const agent = new PlannerAgent(mockModel(), api);
		agent.init(sampleContext());

		const result = await agent.replan("plan", "");
		expect(typeof result).toBe("string");
	});
});

describe("PlannerAgent error handling", () => {
	test("propagates error from api.chat", async () => {
		const api = createApi("");
		api.chat = mock(async () => {
			throw new Error("LLM error");
		});
		const agent = new PlannerAgent(mockModel(), api);
		agent.init(sampleContext());

		expect(agent.selectNodes("task")).rejects.toThrow("LLM error");
	});

	test("throws if not initialized", async () => {
		const agent = new PlannerAgent(mockModel(), createApi(""));
		expect(agent.selectNodes("task")).rejects.toThrow("Agent not initialized");
	});

	test("throws on analyzeTask if not initialized", async () => {
		const agent = new PlannerAgent(mockModel(), createApi(""));
		expect(agent.analyzeTask("task")).rejects.toThrow();
	});
});

describe("PlannerAgent model parameter", () => {
	test("uses custom model from constructor for api calls", async () => {
		const model: ModelEntry = { provider: "custom", model: "gpt-4" };
		const api = createApi("plan, generate, report");
		const agent = new PlannerAgent(model, api);
		agent.init(sampleContext());

		await agent.selectNodes("task");
		// biome-ignore lint/suspicious/noExplicitAny: accessing mock internals from bun:test
		const callArgs = (api.chat as any).mock.calls[0];
		expect(callArgs[0]).toEqual(model);
	});
});
