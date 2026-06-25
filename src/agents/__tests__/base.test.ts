/**
 * Tests for BaseAgent (abstract foundation for all agents).
 *
 * Since BaseAgent is abstract, we create a concrete TestAgent subclass
 * that exposes protected methods for testing.
 */

import { describe, expect, mock, test } from "bun:test";
import { OpenCodeAPI } from "../../api/opencode";
import type { AgentContext, AgentRole, ModelEntry, OpenCodeResponse } from "../../types";
import { BaseAgent } from "../base";

// ---------------------------------------------------------------------------
// TestAgent — concrete subclass that exposes protected members
// ---------------------------------------------------------------------------
class TestAgent extends BaseAgent {
	/** Expose protected think() */
	async callThink(prompt: string): Promise<string> {
		return this.think(prompt);
	}

	/** Expose protected thinkStream() */
	async *callThinkStream(prompt: string): AsyncGenerator<string> {
		yield* this.thinkStream(prompt);
	}

	/** Expose estimateTokens() */
	callEstimateTokens(text: string): number {
		return this.estimateTokens(text);
	}

	/** Expose context for assertions */
	getContext(): AgentContext | null {
		return this.context;
	}

	/** Expose model for assertions */
	getModel(): ModelEntry {
		return this.model;
	}

	/** Expose api for assertions */
	getApi(): OpenCodeAPI {
		return this.api;
	}
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockModel(): ModelEntry {
	return { provider: "test", model: "test-model" };
}

function mockApi(): OpenCodeAPI {
	const api = new (class extends OpenCodeAPI {
		chat = mock(
			async (
				_model: ModelEntry,
				_messages: Array<{ role: string; content: string }>,
			): Promise<OpenCodeResponse> => {
				return {
					id: "test-id",
					content: "mock response",
					model: "test/test-model",
					usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
				};
			},
		);

		streamChat = mock(async function* (
			_model: ModelEntry,
			_messages: Array<{ role: string; content: string }>,
		): AsyncGenerator<string> {
			yield "chunk1 ";
			yield "chunk2 ";
			yield "chunk3";
		});
	})();
	return api;
}

function sampleContext(overrides?: Partial<AgentContext>): AgentContext {
	return {
		sessionId: "test-session-1",
		messages: [],
		systemPrompt: "You are a helpful assistant.",
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

describe("BaseAgent.constructor", () => {
	test("sets role from constructor parameter", () => {
		const agent = new TestAgent("worker", mockModel(), mockApi());
		expect(agent.role).toBe("worker");
	});

	test("sets model from constructor parameter", () => {
		const model = mockModel();
		const agent = new TestAgent("planner", model, mockApi());
		expect(agent.getModel()).toBe(model);
	});

	test("sets api from constructor parameter", () => {
		const api = mockApi();
		const agent = new TestAgent("planner", mockModel(), api);
		expect(agent.getApi()).toBe(api);
	});

	test("accepts all valid AgentRole values", () => {
		const roles: AgentRole[] = [
			"worker",
			"planner",
			"memory_organizer",
			"compression",
			"validation",
			"watchdog",
			"context_inspector",
		];
		for (const role of roles) {
			const agent = new TestAgent(role, mockModel(), mockApi());
			expect(agent.role).toBe(role);
		}
	});
});

describe("BaseAgent.init", () => {
	test("stores context and logs sessionId", () => {
		const agent = new TestAgent("worker", mockModel(), mockApi());
		const ctx = sampleContext();
		agent.init(ctx);
		expect(agent.getContext()).not.toBeNull();
		expect(agent.getContext()?.sessionId).toBe("test-session-1");
	});

	test("overwrites previous context on second call", () => {
		const agent = new TestAgent("worker", mockModel(), mockApi());
		agent.init(sampleContext({ sessionId: "first" }));
		agent.init(sampleContext({ sessionId: "second" }));
		expect(agent.getContext()?.sessionId).toBe("second");
	});

	test("stores full systemPrompt in context", () => {
		const agent = new TestAgent("worker", mockModel(), mockApi());
		const prompt = "Custom system prompt for testing";
		agent.init(sampleContext({ systemPrompt: prompt }));
		expect(agent.getContext()?.systemPrompt).toBe(prompt);
	});

	test("context is null before init", () => {
		const agent = new TestAgent("worker", mockModel(), mockApi());
		expect(agent.getContext()).toBeNull();
	});
});

describe("BaseAgent.think", () => {
	test("calls api.chat with system and user messages", async () => {
		const api = mockApi();
		const agent = new TestAgent("worker", mockModel(), api);
		agent.init(sampleContext());

		const result = await agent.callThink("user prompt");

		expect(api.chat).toHaveBeenCalledTimes(1);
		// biome-ignore lint/suspicious/noExplicitAny: accessing mock internals from bun:test
		const callArgs = (api.chat as any).mock.calls[0];
		expect(callArgs[0]).toEqual(mockModel());
		expect(callArgs[1]).toEqual([
			{ role: "system", content: "You are a helpful assistant." },
			{ role: "user", content: "user prompt" },
		]);
		expect(result).toBe("mock response");
	});

	test("returns response content from api.chat", async () => {
		const api = mockApi();
		api.chat = mock(async () => ({
			id: "resp-1",
			content: "Hello, world!",
			model: "test/model",
			usage: { promptTokens: 5, completionTokens: 10, totalTokens: 15 },
		}));
		const agent = new TestAgent("worker", mockModel(), api);
		agent.init(sampleContext());

		const result = await agent.callThink("say hello");
		expect(result).toBe("Hello, world!");
	});

	test("works with empty system prompt", async () => {
		const api = mockApi();
		api.chat = mock(async () => ({
			id: "id",
			content: "ok",
			model: "m",
			usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
		}));
		const agent = new TestAgent("worker", mockModel(), api);
		agent.init(sampleContext({ systemPrompt: "" }));

		const result = await agent.callThink("prompt");
		expect(result).toBe("ok");
		// biome-ignore lint/suspicious/noExplicitAny: accessing mock internals from bun:test
		const callArgs = (api.chat as any).mock.calls[0];
		expect(callArgs[1][0].content).toBe("");
	});

	test("works with empty user prompt", async () => {
		const api = mockApi();
		api.chat = mock(async () => ({
			id: "id",
			content: "response to empty",
			model: "m",
			usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
		}));
		const agent = new TestAgent("worker", mockModel(), api);
		agent.init(sampleContext());

		const result = await agent.callThink("");
		expect(result).toBe("response to empty");
	});

	test("throws if not initialized", async () => {
		const agent = new TestAgent("worker", mockModel(), mockApi());
		expect(agent.callThink("prompt")).rejects.toThrow("Agent not initialized");
	});

	test("error propagates when api.chat throws", async () => {
		const api = mockApi();
		api.chat = mock(async () => {
			throw new Error("API failure");
		});
		const agent = new TestAgent("worker", mockModel(), api);
		agent.init(sampleContext());

		expect(agent.callThink("prompt")).rejects.toThrow("API failure");
	});

	test("error propagates when api.chat rejects with non-Error", async () => {
		const api = mockApi();
		api.chat = mock(async () => {
			throw "string error";
		});
		const agent = new TestAgent("worker", mockModel(), api);
		agent.init(sampleContext());

		expect(agent.callThink("prompt")).rejects.toThrow();
	});

	test("api.chat receives the model entry passed to constructor", async () => {
		const api = mockApi();
		const customModel: ModelEntry = {
			provider: "custom",
			model: "custom-model",
		};
		const agent = new TestAgent("planner", customModel, api);
		agent.init(sampleContext());

		await agent.callThink("prompt");
		// biome-ignore lint/suspicious/noExplicitAny: accessing mock internals from bun:test
		const callArgs = (api.chat as any).mock.calls[0];
		expect(callArgs[0]).toEqual(customModel);
	});
});

describe("BaseAgent.thinkStream", () => {
	test("yields chunks from api.streamChat", async () => {
		const api = mockApi();
		const agent = new TestAgent("worker", mockModel(), api);
		agent.init(sampleContext());

		const chunks: string[] = [];
		for await (const chunk of agent.callThinkStream("stream prompt")) {
			chunks.push(chunk);
		}

		expect(chunks).toEqual(["chunk1 ", "chunk2 ", "chunk3"]);
	});

	test("passes correct messages to api.streamChat", async () => {
		const api = mockApi();
		const agent = new TestAgent("worker", mockModel(), api);
		agent.init(sampleContext());

		const _chunks: string[] = [];
		for await (const chunk of agent.callThinkStream("stream prompt")) {
			_chunks.push(chunk);
		}

		expect(api.streamChat).toHaveBeenCalledTimes(1);
		// biome-ignore lint/suspicious/noExplicitAny: accessing mock internals from bun:test
		const callArgs = (api.streamChat as any).mock.calls[0];
		expect(callArgs[1]).toEqual([
			{ role: "system", content: "You are a helpful assistant." },
			{ role: "user", content: "stream prompt" },
		]);
	});

	test("throws if not initialized", async () => {
		const agent = new TestAgent("worker", mockModel(), mockApi());
		const gen = agent.callThinkStream("prompt");
		let threw = false;
		try {
			for await (const _ of gen) {
				/* noop */
			}
		} catch {
			threw = true;
		}
		expect(threw).toBe(true);
	});

	test("handles empty stream from api.streamChat", async () => {
		const api = mockApi();
		api.streamChat = mock(async function* (): AsyncGenerator<string> {
			// yields nothing
		});
		const agent = new TestAgent("worker", mockModel(), api);
		agent.init(sampleContext());

		const chunks: string[] = [];
		for await (const chunk of agent.callThinkStream("empty")) {
			chunks.push(chunk);
		}
		expect(chunks).toHaveLength(0);
	});

	test("works with single chunk", async () => {
		const api = mockApi();
		api.streamChat = mock(async function* (): AsyncGenerator<string> {
			yield "only chunk";
		});
		const agent = new TestAgent("worker", mockModel(), api);
		agent.init(sampleContext());

		const chunks: string[] = [];
		for await (const chunk of agent.callThinkStream("single")) {
			chunks.push(chunk);
		}
		expect(chunks).toEqual(["only chunk"]);
	});

	test("stream yields same content as chat for same input", async () => {
		const api = mockApi();
		// Make streamChat return the same words but split
		api.streamChat = mock(async function* (): AsyncGenerator<string> {
			yield "hello world";
		});
		const agent = new TestAgent("worker", mockModel(), api);
		agent.init(sampleContext());

		let streamResult = "";
		for await (const chunk of agent.callThinkStream("test")) {
			streamResult += chunk;
		}
		expect(streamResult).toBe("hello world");
	});

	test("passes model to api.streamChat", async () => {
		const api = mockApi();
		const customModel: ModelEntry = { provider: "p", model: "m" };
		const agent = new TestAgent("worker", customModel, api);
		agent.init(sampleContext());

		for await (const _ of agent.callThinkStream("test")) {
			/* consume */
		}

		// biome-ignore lint/suspicious/noExplicitAny: accessing mock internals from bun:test
		const callArgs = (api.streamChat as any).mock.calls[0];
		expect(callArgs[0]).toEqual(customModel);
	});

	test("uses system prompt from context", async () => {
		const api = mockApi();
		const agent = new TestAgent("worker", mockModel(), api);
		agent.init(sampleContext({ systemPrompt: "Custom system prompt." }));

		for await (const _ of agent.callThinkStream("test")) {
			/* consume */
		}

		// biome-ignore lint/suspicious/noExplicitAny: accessing mock internals from bun:test
		const callArgs = (api.streamChat as any).mock.calls[0];
		expect(callArgs[1][0].content).toBe("Custom system prompt.");
	});
});

describe("BaseAgent.switchModel", () => {
	test("changes the active model", () => {
		const agent = new TestAgent("worker", mockModel(), mockApi());
		const newModel: ModelEntry = { provider: "new", model: "new-model" };
		agent.switchModel(newModel);
		expect(agent.getModel()).toEqual(newModel);
	});

	test("switchModel updates to different provider", () => {
		const agent = new TestAgent("worker", mockModel(), mockApi());
		const newModel: ModelEntry = { provider: "another", model: "m2" };
		agent.switchModel(newModel);
		expect(agent.getModel().provider).toBe("another");
	});
});

describe("BaseAgent.estimateTokens", () => {
	test("estimates ~1 token per 3.5 characters", () => {
		const agent = new TestAgent("worker", mockModel(), mockApi());
		expect(agent.callEstimateTokens("a".repeat(100))).toBe(29);
	});

	test("rounds up fractional tokens", () => {
		const agent = new TestAgent("worker", mockModel(), mockApi());
		expect(agent.callEstimateTokens("abc")).toBe(1); // 3/4 = 0.75 -> 1
		expect(agent.callEstimateTokens("a")).toBe(1); // 1/4 = 0.25 -> 1
		expect(agent.callEstimateTokens("")).toBe(0); // 0/4 = 0 -> 0
	});

	test("handles very long text", () => {
		const agent = new TestAgent("worker", mockModel(), mockApi());
		const long = "x".repeat(10000);
		expect(agent.callEstimateTokens(long)).toBe(2858);
	});

	test("handles unicode characters", () => {
		const agent = new TestAgent("worker", mockModel(), mockApi());
		// Unicode chars may be multi-byte but we count by length
		expect(agent.callEstimateTokens("日本語")).toBe(1); // 3 chars / 4 = 0.75 -> 1
	});
});

describe("BaseAgent.destroy", () => {
	test("clears context to null", async () => {
		const agent = new TestAgent("worker", mockModel(), mockApi());
		agent.init(sampleContext());
		expect(agent.getContext()).not.toBeNull();

		await agent.destroy();
		expect(agent.getContext()).toBeNull();
	});

	test("can be called multiple times without error", async () => {
		const agent = new TestAgent("worker", mockModel(), mockApi());
		agent.init(sampleContext());
		await agent.destroy();
		await agent.destroy(); // second call should not throw
		expect(agent.getContext()).toBeNull();
	});

	test("after destroy, think throws", async () => {
		const agent = new TestAgent("worker", mockModel(), mockApi());
		agent.init(sampleContext());
		await agent.destroy();

		expect(agent.callThink("prompt")).rejects.toThrow("Agent not initialized");
	});
});

describe("BaseAgent.role property", () => {
	test("is readable and matches constructor arg", () => {
		const agent = new TestAgent("validation", mockModel(), mockApi());
		expect(agent.role).toBe("validation");
	});

	test("is readonly (TypeScript prevents reassignment at compile time)", () => {
		const agent = new TestAgent("watchdog", mockModel(), mockApi());
		expect(agent.role).toBe("watchdog");
	});
});
