/**
 * Tests for ContextInspectorAgent.
 *
 * ContextInspectorAgent detects context corruption (drift, stuck TODOs,
 * repeated errors, assumption fixation, unrecognized error shifts).
 */

import { describe, expect, mock, test } from "bun:test";
import { OpenCodeAPI } from "../../api/opencode";
import type { AgentContext, ModelEntry } from "../../types";
import { ContextInspectorAgent } from "../context-inspector";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockModel(): ModelEntry {
	return { provider: "test", model: "inspector-model" };
}

function createApi(): OpenCodeAPI {
	return new (class extends OpenCodeAPI {
		chat = mock(async () => ({
			id: "resp",
			content: "remediation suggestion",
			model: "m",
			usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
		}));
		streamChat = mock(async function* () {});
	})();
}

function createInspector(): ContextInspectorAgent {
	return new ContextInspectorAgent(mockModel(), createApi());
}

function sampleContext(overrides?: Partial<AgentContext>): AgentContext {
	return {
		sessionId: "inspector-session",
		messages: [],
		systemPrompt: "Inspector prompt.",
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

describe("ContextInspectorAgent.constructor", () => {
	test("sets role to context_inspector", () => {
		const agent = createInspector();
		expect(agent.role).toBe("context_inspector");
	});

	test("stores model parameter", () => {
		const agent = createInspector();
		expect(agent.getModel()).toEqual(mockModel());
	});
});

describe("ContextInspectorAgent.init", () => {
	test("stores context", () => {
		const agent = createInspector();
		agent.init(sampleContext());
		expect(agent.getContext()).not.toBeNull();
	});
});

describe("ContextInspectorAgent.inspect", () => {
	test("returns InspectionResult with score 0 for first clean inspection", () => {
		const agent = createInspector();
		const result = agent.inspect({
			currentFocus: "Implement login feature",
			errors: [],
			todos: ["Add login form", "Add validation"],
			messages: [{ role: "user", content: "Build a login page" }],
		});

		expect(result.score).toBe(0);
		expect(result.sameErrorRepeated).toBe(false);
		expect(result.purposeForgotten).toBe(false);
		expect(result.todoStuck).toBe(false);
		expect(result.assumptionFixed).toBe(false);
		expect(result.errorChangeUnrecognized).toBe(false);
		expect(result.details).toHaveLength(0);
	});

	test("detects same error repeated across inspections", () => {
		const agent = createInspector();

		// Need 3 setup inspections so previousStates has 3 entries with same error
		for (let i = 0; i < 3; i++) {
			agent.inspect({
				currentFocus: "Fix bug",
				errors: ["TypeError in parse"],
				todos: [],
				messages: [{ role: "user", content: "Fix it" }],
			});
		}

		const result = agent.inspect({
			currentFocus: "Fix bug",
			errors: ["TypeError in parse"],
			todos: [],
			messages: [{ role: "user", content: "Fix it" }],
		});

		// TypeError appears 3 times across 3 previousStates → count >= 3 → flagged
		expect(result.sameErrorRepeated).toBe(true);
		expect(result.details.some((d) => d.includes("Same error"))).toBe(true);
		expect(result.score).toBeGreaterThan(0);
	});

	test("detects purpose drift when focus diverges from original task", () => {
		const agent = createInspector();

		const result = agent.inspect({
			currentFocus: "Completely unrelated topic",
			errors: [],
			todos: [],
			messages: [
				{
					role: "user",
					content:
						"Build a user authentication system with login, registration, and password reset",
				},
				{ role: "assistant", content: "I can help with that" },
				{ role: "user", content: "Let's start" },
				{ role: "assistant", content: "OK" },
				{ role: "user", content: "Go ahead" },
			],
		});

		// Focus "Completely unrelated topic" doesn't share many keywords with "authentication system"
		// Need >= 5 messages and mismatched focus
		expect(result.purposeForgotten).toBe(true);
		expect(result.details.some((d) => d.includes("Purpose drift"))).toBe(true);
	});

	test("no purpose drift when focus matches original task", () => {
		const agent = createInspector();

		const result = agent.inspect({
			currentFocus: "Build authentication system login flow",
			errors: [],
			todos: [],
			messages: [
				{ role: "user", content: "Build a user authentication system" },
				{ role: "assistant", content: "OK" },
				{ role: "user", content: "Start" },
				{ role: "assistant", content: "Done" },
				{ role: "user", content: "Review" },
			],
		});

		expect(result.purposeForgotten).toBe(false);
	});

	test("no purpose drift with fewer than 5 messages", () => {
		const agent = createInspector();

		const result = agent.inspect({
			currentFocus: "Something else",
			errors: [],
			todos: [],
			messages: [
				{ role: "user", content: "Task" },
				{ role: "assistant", content: "Reply" },
			],
		});

		expect(result.purposeForgotten).toBe(false);
	});

	test("detects stuck TODOs", () => {
		const agent = createInspector();

		// Need 3 setup inspections so previousStates has 3+ entries
		for (let i = 0; i < 3; i++) {
			agent.inspect({
				currentFocus: "Work",
				errors: [],
				todos: ["Fix login bug"],
				messages: [{ role: "user", content: "Help" }],
			});
		}

		const result = agent.inspect({
			currentFocus: "Work",
			errors: [],
			todos: ["Fix login bug"],
			messages: [{ role: "user", content: "Help" }],
		});

		// previousStates has 3+ entries with same TODO → flagged
		expect(result.todoStuck).toBe(true);
	});

	test("no stuck TODO when TODOs change", () => {
		const agent = createInspector();

		agent.inspect({
			currentFocus: "Work",
			errors: [],
			todos: ["Fix auth"],
			messages: [{ role: "user", content: "Help" }],
		});
		agent.inspect({
			currentFocus: "Work",
			errors: [],
			todos: ["Fix auth"],
			messages: [{ role: "user", content: "Help" }],
		});

		const result = agent.inspect({
			currentFocus: "Work",
			errors: [],
			todos: ["Fix UI"],
			messages: [{ role: "user", content: "Help" }],
		});

		// TODO changed, so not stuck
		expect(result.todoStuck).toBe(false);
	});

	test("detects assumption fixation", () => {
		const agent = createInspector();

		// Need 3 setup inspections so previousStates has 3+ entries
		for (let i = 0; i < 3; i++) {
			agent.inspect({
				currentFocus: "Work",
				errors: [],
				todos: [],
				assumptions: ["The bug is in auth"],
				messages: [{ role: "user", content: "Help" }],
			});
		}

		const result = agent.inspect({
			currentFocus: "Work",
			errors: [],
			todos: [],
			assumptions: ["The bug is in auth"],
			messages: [{ role: "user", content: "Help" }],
		});

		// Assumption persisted across 3 previous states → count >= 2 → flagged
		expect(result.assumptionFixed).toBe(true);
	});

	test("no assumption fixation with fewer than 3 states", () => {
		const agent = createInspector();

		const result = agent.inspect({
			currentFocus: "Work",
			errors: [],
			todos: [],
			assumptions: ["Some assumption"],
			messages: [{ role: "user", content: "Help" }],
		});

		expect(result.assumptionFixed).toBe(false);
	});

	test("detects error change unrecognized when errors shift", () => {
		const agent = createInspector();

		// Need 2+ previousStates before detection kicks in
		agent.inspect({
			currentFocus: "Fix",
			errors: ["TypeError"],
			todos: [],
			messages: [{ role: "user", content: "Fix" }],
		});
		agent.inspect({
			currentFocus: "Fix",
			errors: ["TypeError"],
			todos: [],
			messages: [{ role: "user", content: "Fix" }],
		});

		// Third inspection with different errors
		const result = agent.inspect({
			currentFocus: "Fix",
			errors: ["SyntaxError", "ReferenceError"],
			todos: [],
			messages: [{ role: "user", content: "Fix" }],
		});

		// Added 2 new errors -> > 1 -> flagged
		expect(result.errorChangeUnrecognized).toBe(true);
	});

	test("no error change flag with single error change", () => {
		const agent = createInspector();

		agent.inspect({
			currentFocus: "Fix",
			errors: ["TypeError"],
			todos: [],
			messages: [{ role: "user", content: "Fix" }],
		});

		const result = agent.inspect({
			currentFocus: "Fix",
			errors: ["SyntaxError"],
			todos: [],
			messages: [{ role: "user", content: "Fix" }],
		});

		// Only 1 error added and 1 removed -> <=1 in each direction
		expect(result.errorChangeUnrecognized).toBe(false);
	});

	test("returns correct score accumulation", () => {
		const agent = createInspector();

		// Need 3 setup inspections so sameErrorRepeated (count>=3) and todoStuck (len>=3) trigger
		for (let i = 0; i < 3; i++) {
			agent.inspect({
				currentFocus: "Fix",
				errors: ["TypeError"],
				todos: ["Fix it"],
				assumptions: [],
				messages: [{ role: "user", content: "Fix this bug" }],
			});
		}

		// Fourth inspection — checks against 3 previousStates
		const result = agent.inspect({
			currentFocus: "Fix",
			errors: ["TypeError"],
			todos: ["Fix it"],
			assumptions: [],
			messages: [{ role: "user", content: "Fix this bug" }],
		});

		// sameErrorRepeated (0.3, TypeError 3x) + todoStuck (0.2, TODO matched 3x) = 0.5
		expect(result.score).toBeGreaterThanOrEqual(0.5);
		expect(result.score).toBeLessThanOrEqual(1.0);
	});

	test("score is capped at 1.0", () => {
		const agent = createInspector();

		// Force all flags to true by setting up the right conditions
		// 1. Same error repeated: 3 inspections with same error
		agent.inspect({
			currentFocus: "Fix",
			errors: ["Err1", "Err2", "Err3"],
			todos: ["TODO1"],
			assumptions: ["Assumption1"],
			messages: [
				{
					role: "user",
					content: "Build a user authentication system with login registration and password reset",
				},
				{ role: "user", content: "msg2" },
				{ role: "user", content: "msg3" },
				{ role: "user", content: "msg4" },
				{ role: "user", content: "msg5" },
			],
		});
		agent.inspect({
			currentFocus: "Fix",
			errors: ["Err1", "Err2", "Err3"],
			todos: ["TODO1"],
			assumptions: ["Assumption1"],
			messages: [
				{
					role: "user",
					content: "Build a user authentication system with login registration and password reset",
				},
				{ role: "user", content: "msg2" },
				{ role: "user", content: "msg3" },
				{ role: "user", content: "msg4" },
				{ role: "user", content: "msg5" },
			],
		});
		const result = agent.inspect({
			currentFocus: "Completely unrelated topic different keywords",
			errors: ["Err4", "Err5", "Err6", "Err7"],
			todos: ["TODO1"],
			assumptions: ["Assumption1"],
			messages: [
				{
					role: "user",
					content: "Build a user authentication system with login registration and password reset",
				},
				{ role: "user", content: "msg2" },
				{ role: "user", content: "msg3" },
				{ role: "user", content: "msg4" },
				{ role: "user", content: "msg5" },
			],
		});

		expect(result.score).toBeLessThanOrEqual(1.0);
	});
});

describe("ContextInspectorAgent edge cases", () => {
	test("handles empty errors array", () => {
		const agent = createInspector();
		const result = agent.inspect({
			currentFocus: "Work",
			errors: [],
			todos: [],
			messages: [{ role: "user", content: "Help" }],
		});
		expect(result.score).toBe(0);
	});

	test("handles empty todos array", () => {
		const agent = createInspector();
		const result = agent.inspect({
			currentFocus: "Work",
			errors: [],
			todos: [],
			messages: [{ role: "user", content: "Help" }],
		});
		expect(result.score).toBe(0);
	});

	test("handles empty messages array", () => {
		const agent = createInspector();
		const result = agent.inspect({
			currentFocus: "Work",
			errors: [],
			todos: [],
			messages: [],
		});
		expect(result.score).toBe(0);
	});

	test("handles undefined assumptions", () => {
		const agent = createInspector();
		const result = agent.inspect({
			currentFocus: "Work",
			errors: [],
			todos: [],
			messages: [],
			assumptions: undefined,
		});
		expect(result.score).toBe(0);
	});

	test("maintains max 20 previous states", () => {
		const agent = createInspector();

		for (let i = 0; i < 25; i++) {
			agent.inspect({
				currentFocus: `Focus ${i}`,
				errors: [],
				todos: [],
				messages: [{ role: "user", content: "Test" }],
			});
		}

		expect(agent.getPreviousStates().length).toBeLessThanOrEqual(20);
	});

	test("handles inspection after many inspections", () => {
		const agent = createInspector();

		for (let i = 0; i < 20; i++) {
			agent.inspect({
				currentFocus: `Focus ${i}`,
				errors: [],
				todos: [],
				messages: [{ role: "user", content: `Msg ${i}` }],
			});
		}

		const result = agent.inspect({
			currentFocus: "Final focus",
			errors: ["Error"],
			todos: ["TODO"],
			messages: [{ role: "user", content: "Final" }],
		});

		expect(result).toHaveProperty("score");
		expect(typeof result.score).toBe("number");
	});
});

describe("ContextInspectorAgent additional edge cases", () => {
	test("no error change when going from no errors to one error", () => {
		const agent = createInspector();
		agent.inspect({
			currentFocus: "Work",
			errors: [],
			todos: [],
			messages: [{ role: "user", content: "Help" }],
		});
		const result = agent.inspect({
			currentFocus: "Work",
			errors: ["NewError"],
			todos: [],
			messages: [{ role: "user", content: "Help" }],
		});
		// 1 added, 0 removed => added.length = 1, which is not > 1
		expect(result.errorChangeUnrecognized).toBe(false);
	});

	test("error change flagged when multiple errors added and removed", () => {
		const agent = createInspector();
		// Need 2+ previousStates
		agent.inspect({
			currentFocus: "Work",
			errors: ["ErrA", "ErrB"],
			todos: [],
			messages: [{ role: "user", content: "Help" }],
		});
		agent.inspect({
			currentFocus: "Work",
			errors: ["ErrA", "ErrB"],
			todos: [],
			messages: [{ role: "user", content: "Help" }],
		});
		const result = agent.inspect({
			currentFocus: "Work",
			errors: ["ErrC", "ErrD", "ErrE"],
			todos: [],
			messages: [{ role: "user", content: "Help" }],
		});
		// Added: ErrC, ErrD, ErrE (3 > 1) or Removed: ErrA, ErrB (2 > 1)
		expect(result.errorChangeUnrecognized).toBe(true);
	});

	test("same error but appearing 2 times does not trigger flag", () => {
		const agent = createInspector();
		agent.inspect({
			currentFocus: "Work",
			errors: ["Err"],
			todos: [],
			messages: [{ role: "user", content: "Help" }],
		});
		const result = agent.inspect({
			currentFocus: "Work",
			errors: ["Err"],
			todos: [],
			messages: [{ role: "user", content: "Help" }],
		});
		// Only 2 states, need 3 for repeated error detection
		expect(result.sameErrorRepeated).toBe(false);
	});

	test("purpose drift not triggered when first message not found", () => {
		const agent = createInspector();
		const result = agent.inspect({
			currentFocus: "Different topic",
			errors: [],
			todos: [],
			messages: [
				{ role: "assistant", content: "Hello" },
				{ role: "assistant", content: "World" },
				{ role: "assistant", content: "Foo" },
				{ role: "assistant", content: "Bar" },
				{ role: "assistant", content: "Baz" },
			],
		});
		// No user message found
		expect(result.purposeForgotten).toBe(false);
	});

	test("score is cumulative when multiple flags are true", () => {
		const agent = createInspector();

		// Need 3 setup inspections so previousStates has enough data for all checks
		const setupCalls = [
			{
				currentFocus: "Fix the auth bug in login",
				errors: ["TypeError"],
				todos: ["Fix login bug"],
				assumptions: [] as string[],
			},
			{
				currentFocus: "Fix the auth bug in login",
				errors: ["TypeError"],
				todos: ["Fix login bug"],
				assumptions: [] as string[],
			},
			{
				currentFocus: "Fix the auth bug in login",
				errors: ["TypeError"],
				todos: ["Fix login bug"],
				assumptions: [] as string[],
			},
		];
		for (const ctx of setupCalls) {
			agent.inspect({
				...ctx,
				messages: [
					{ role: "user", content: "Fix the authentication system login bug" },
					{ role: "user", content: "m2" },
					{ role: "user", content: "m3" },
					{ role: "user", content: "m4" },
					{ role: "user", content: "m5" },
				],
			});
		}

		const result = agent.inspect({
			currentFocus: "Watching cat videos on youtube",
			errors: ["TypeError"],
			todos: ["Fix login bug"],
			assumptions: [],
			messages: [
				{ role: "user", content: "Fix the authentication system login bug" },
				{ role: "user", content: "m2" },
				{ role: "user", content: "m3" },
				{ role: "user", content: "m4" },
				{ role: "user", content: "m5" },
			],
		});

		// sameErrorRepeated (0.3, TypeError appears 3x in previousStates) +
		// purposeForgotten (0.2, focus changed away from auth/login keywords) +
		// todoStuck (0.2, same TODO across 3+ previous states) = 0.7
		expect(result.score).toBeGreaterThanOrEqual(0.5);
	});
});

describe("ContextInspectorAgent.suggestRemediation", () => {
	test("returns no remediation for low score", async () => {
		const agent = createInspector();
		const result = await agent.suggestRemediation({
			sameErrorRepeated: false,
			purposeForgotten: false,
			todoStuck: false,
			assumptionFixed: false,
			errorChangeUnrecognized: false,
			details: [],
			score: 0,
		});
		expect(result).toBe("No remediation needed.");
	});

	test("calls think() when remediation is needed", async () => {
		const agent = createInspector();
		agent.init(sampleContext());

		const result = await agent.suggestRemediation({
			sameErrorRepeated: true,
			purposeForgotten: false,
			todoStuck: true,
			assumptionFixed: false,
			errorChangeUnrecognized: false,
			details: ["Same error 3x", "TODOs stuck"],
			score: 0.5,
		});

		expect(result).toBe("remediation suggestion");
	});

	test("includes relevant issues in remediation prompt", async () => {
		const api = createApi();
		const agent = new ContextInspectorAgent(mockModel(), api);
		agent.init(sampleContext());

		await agent.suggestRemediation({
			sameErrorRepeated: true,
			purposeForgotten: true,
			todoStuck: false,
			assumptionFixed: false,
			errorChangeUnrecognized: false,
			details: ["Same error 3x", "Purpose drift"],
			score: 0.5,
		});

		expect(api.chat).toHaveBeenCalledTimes(1);
		// biome-ignore lint/suspicious/noExplicitAny: accessing mock internals from bun:test
		const callArgs = (api.chat as any).mock.calls[0];
		const prompt = callArgs[1][1].content;
		expect(prompt).toContain("remediation");
	});
});
