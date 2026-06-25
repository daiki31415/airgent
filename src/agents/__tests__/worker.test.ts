/**
 * Tests for WorkerAgent.
 *
 * WorkerAgent extends BaseAgent and uses think() / thinkStream()
 * for task execution with context enhancement.
 */

import { describe, expect, mock, test } from "bun:test";
import { OpenCodeAPI } from "../../api/opencode";
import { CompressionManager } from "../../compression";
import { MemorySystem } from "../../memory";
import { SkillsManager } from "../../skills";
import { Storage } from "../../storage";
import type {
	AgentContext,
	CompressedEntry,
	ModelEntry,
	OpenCodeResponse,
} from "../../types";
import { WorkerAgent } from "../worker";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockModel(): ModelEntry {
	return { provider: "test", model: "worker-model" };
}

function createApi(chatResponse?: string): OpenCodeAPI {
	const api = new (class extends OpenCodeAPI {
		chat = mock(
			async (
				_model: ModelEntry,
				_messages: Array<{ role: string; content: string }>,
			): Promise<OpenCodeResponse> => {
				return {
					id: "worker-resp",
					content: chatResponse ?? "worker response",
					model: "test/model",
					usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
				};
			},
		);

		streamChat = mock(async function* (
			_model: ModelEntry,
			_messages: Array<{ role: string; content: string }>,
		): AsyncGenerator<string> {
			yield "chunk-a ";
			yield "chunk-b";
		});
	})();
	return api;
}

function createCompressionManager(): CompressionManager {
	return new (class extends CompressionManager {
		constructor() {
			super(null as any, null as any);
		}
		override findForDecompression(): CompressedEntry[] {
			return [];
		}
	})();
}

function createMockStorage(): Storage {
	return new Storage(":memory:");
}

function createWorker(overrides?: {
	chatResponse?: string;
	compression?: CompressionManager;
	api?: OpenCodeAPI;
}): { worker: WorkerAgent; api: OpenCodeAPI; storage: Storage } {
	const api = overrides?.api ?? createApi(overrides?.chatResponse);
	const compression = overrides?.compression ?? createCompressionManager();
	const skills = new SkillsManager();
	const storage = createMockStorage();
	const memorySystem = new MemorySystem(storage);

	const worker = new WorkerAgent(
		mockModel(),
		api,
		compression,
		skills,
		memorySystem,
	);
	return { worker, api, storage };
}

function sampleContext(overrides?: Partial<AgentContext>): AgentContext {
	return {
		sessionId: "worker-session",
		messages: [],
		systemPrompt: "You are a coding assistant.",
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

describe("WorkerAgent.constructor", () => {
	test("sets role to worker", () => {
		const { worker } = createWorker();
		expect(worker.role).toBe("worker");
	});

	test("stores model parameter", () => {
		const { worker } = createWorker();
		expect((worker as any).model).toEqual(mockModel());
	});
});

describe("WorkerAgent.init", () => {
	test("stores context from init call", () => {
		const { worker } = createWorker();
		worker.init(sampleContext());
		expect((worker as any).context).not.toBeNull();
		expect((worker as any).context?.sessionId).toBe("worker-session");
	});
});

describe("WorkerAgent.execute (non-streaming)", () => {
	test("returns { content } with response text", async () => {
		const { worker, api } = createWorker({ chatResponse: "final output" });
		worker.init(sampleContext());

		const result = await worker.execute("build feature");
		expect(result).toEqual({ content: "final output" });
	});

	test("calls api.chat with system prompt and user prompt", async () => {
		const { worker, api } = createWorker();
		worker.init(sampleContext());

		await worker.execute("test prompt");

		expect(api.chat).toHaveBeenCalledTimes(1);
		const callArgs = (api.chat as any).mock.calls[0];
		expect(callArgs[1][0].content).toBe("You are a coding assistant.");
		expect(callArgs[1][1].content).toContain("test prompt");
	});

	test("records raw memory for prompt", async () => {
		const { worker, storage } = createWorker();
		worker.init(sampleContext());

		await worker.execute("record test");

		const logs = storage.getRawLogs("worker-session");
		const workerLogs = logs.filter((l) => l.agent_role === "worker");
		expect(workerLogs.length).toBeGreaterThanOrEqual(1);
	});

	test("records raw memory for response", async () => {
		const { worker, storage } = createWorker({ chatResponse: "response text" });
		worker.init(sampleContext());

		await worker.execute("record response");

		const logs = storage.getRawLogs("worker-session");
		const respLogs = logs.filter((l) => l.agent_role === "worker_response");
		expect(respLogs.length).toBeGreaterThanOrEqual(1);
		// The response should be stored somewhere
		const allContent = logs.map((l) => l.content).join(" ");
		expect(allContent).toContain("record response");
	});

	test("passes full prompt with context enhancement", async () => {
		const { worker, api } = createWorker({ chatResponse: "result" });
		worker.init(sampleContext());

		await worker.execute("do something");

		const callArgs = (api.chat as any).mock.calls[0];
		const fullPrompt = callArgs[1][1].content;
		expect(fullPrompt).toContain("do something");
	});

	test("handles very long prompt", async () => {
		const { worker } = createWorker({ chatResponse: "done" });
		worker.init(sampleContext());

		const longPrompt = "x".repeat(50000);
		const result = await worker.execute(longPrompt);
		expect(result.content).toBe("done");
	});
});

describe("WorkerAgent.execute (streaming with onChunk)", () => {
	test("returns { content } with complete streamed text", async () => {
		const { worker } = createWorker();
		worker.init(sampleContext());

		const chunks: string[] = [];
		const result = await worker.execute("stream test", (chunk) => {
			chunks.push(chunk);
		});

		expect(result.content).toBe("chunk-a chunk-b");
	});

	test("calls onChunk for each stream chunk", async () => {
		const { worker } = createWorker();
		worker.init(sampleContext());

		const chunks: string[] = [];
		await worker.execute("stream test", (chunk) => {
			chunks.push(chunk);
		});

		expect(chunks).toEqual(["chunk-a ", "chunk-b"]);
	});

	test("calls api.streamChat when onChunk is provided", async () => {
		const { worker, api } = createWorker();
		worker.init(sampleContext());

		await worker.execute("stream", () => {});

		expect(api.streamChat).toHaveBeenCalledTimes(1);
		expect(api.chat).toHaveBeenCalledTimes(0);
	});

	test("records memory for streamed response", async () => {
		const { worker, storage } = createWorker();
		worker.init(sampleContext());

		await worker.execute("stream", () => {});

		const logs = storage.getRawLogs("worker-session");
		const respLogs = logs.filter((l) => l.agent_role === "worker_response");
		expect(respLogs.length).toBeGreaterThanOrEqual(1);
	});

	test("handles empty onChunk callback", async () => {
		const { worker } = createWorker();
		worker.init(sampleContext());

		const result = await worker.execute("test", () => {});
		expect(result.content).toBeTruthy();
	});

	test("onChunk is called with incremental content", async () => {
		const api = new (class extends OpenCodeAPI {
			chat = mock(async () => ({
				id: "id",
				content: "",
				model: "m",
				usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
			}));
			streamChat = mock(async function* (): AsyncGenerator<string> {
				yield "part1";
				yield "part2";
				yield "part3";
			});
		})();
		const { worker } = createWorker({ api });
		worker.init(sampleContext());

		const chunks: string[] = [];
		const result = await worker.execute("multi", (chunk) => {
			chunks.push(chunk);
		});

		expect(chunks).toEqual(["part1", "part2", "part3"]);
		expect(result.content).toBe("part1part2part3");
	});
});

describe("WorkerAgent error handling", () => {
	test("propagates error from api.chat (non-streaming)", async () => {
		const api = createApi();
		api.chat = mock(async () => {
			throw new Error("Chat failure");
		});
		const { worker } = createWorker({ api });
		worker.init(sampleContext());

		expect(worker.execute("fail")).rejects.toThrow("Chat failure");
	});

	test("propagates error from api.streamChat (streaming)", async () => {
		const api = new (class extends OpenCodeAPI {
			chat = mock(async () => ({
				id: "id",
				content: "",
				model: "m",
				usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
			}));
			streamChat = mock(async function* (): AsyncGenerator<string> {
				throw new Error("Stream failure");
				yield "never"; // unreachable
			});
		})();
		const { worker } = createWorker({ api });
		worker.init(sampleContext());

		expect(worker.execute("fail stream", () => {})).rejects.toThrow(
			"Stream failure",
		);
	});

	test("throws if not initialized", async () => {
		const { worker } = createWorker();
		expect(worker.execute("nope")).rejects.toThrow("Agent not initialized");
	});

	test("throws if not initialized with streaming", async () => {
		const { worker } = createWorker();
		expect(worker.execute("nope", () => {})).rejects.toThrow(
			"Agent not initialized",
		);
	});
});

describe("WorkerAgent with context enhancement", () => {
	test("includes compressed context in prompt when available", async () => {
		const compression = new (class extends CompressionManager {
			constructor() {
				super(null as any, null as any);
			}
			override findForDecompression() {
				return [
					{
						id: "c1",
						originalId: "o1",
						title: "Auth fix",
						topics: ["auth", "login"],
						timestamp: 0,
						entities: [],
						files: [],
						commands: [],
						errorKeywords: [],
						importanceScore: 0.8,
						tokenCount: 100,
						compressedContent: "fixed auth bug",
					},
				];
			}
		})();
		const { worker, api } = createWorker({ compression, chatResponse: "done" });
		worker.init(sampleContext());

		await worker.execute("bug: TypeError in src/auth.ts");

		const callArgs = (api.chat as any).mock.calls[0];
		const fullPrompt = callArgs[1][1].content;
		expect(fullPrompt).toContain("Auth fix");
		expect(fullPrompt).toContain("auth");
	});

	test("works without compressed context", async () => {
		const { worker, api } = createWorker({ chatResponse: "done" });
		worker.init(sampleContext());

		await worker.execute("simple task");

		const callArgs = (api.chat as any).mock.calls[0];
		const fullPrompt = callArgs[1][1].content;
		// Should not contain "Relevant past context" header
		expect(fullPrompt).not.toContain("Relevant past context");
	});
});

describe("WorkerAgent.extractTopics", () => {
	test("extracts topics from patterns in prompt", async () => {
		// extractTopics is private; we test indirectly via execute
		const { worker, api } = createWorker({ chatResponse: "done" });
		worker.init(sampleContext());

		await worker.execute("fix bug: TypeError in src/util.ts");

		const callArgs = (api.chat as any).mock.calls[0];
		const prompt = callArgs[1][1].content;
		expect(prompt).toContain("TypeError");
		expect(prompt).toContain("src/util.ts");
	});

	test("extracts error type keywords", async () => {
		const { worker, api } = createWorker({ chatResponse: "done" });
		worker.init(sampleContext());

		await worker.execute("ReferenceError in test.js");

		const callArgs = (api.chat as any).mock.calls[0];
		const prompt = callArgs[1][1].content;
		expect(prompt).toContain("ReferenceError");
	});
});

describe("WorkerAgent model usage", () => {
	test("passes model to api.chat", async () => {
		const { worker, api } = createWorker({ chatResponse: "ok" });
		worker.init(sampleContext());

		await worker.execute("test");

		const callArgs = (api.chat as any).mock.calls[0];
		expect(callArgs[0]).toEqual(mockModel());
	});
});

describe("WorkerAgent edge cases", () => {
	test("handles empty prompt", async () => {
		const { worker } = createWorker({ chatResponse: "response" });
		worker.init(sampleContext());

		const result = await worker.execute("");
		expect(result.content).toBe("response");
	});

	test("handles special characters in prompt", async () => {
		const { worker } = createWorker({ chatResponse: "ok" });
		worker.init(sampleContext());

		const result = await worker.execute("line1\nline2\t\0<script>");
		expect(result.content).toBe("ok");
	});

	test("execute returns structured result object", async () => {
		const { worker } = createWorker({ chatResponse: "structured" });
		worker.init(sampleContext());

		const result = await worker.execute("task");
		expect(result).toBeDefined();
		expect(typeof result.content).toBe("string");
	});

	test("execute with onChunk but empty stream yields empty content", async () => {
		const api = new (class extends OpenCodeAPI {
			chat = mock(async () => ({
				id: "id",
				content: "",
				model: "m",
				usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
			}));
			streamChat = mock(async function* (): AsyncGenerator<string> {
				// no yields
			});
		})();
		const { worker } = createWorker({ api });
		worker.init(sampleContext());

		const chunks: string[] = [];
		const result = await worker.execute("empty stream", (c) => chunks.push(c));
		expect(result.content).toBe("");
		expect(chunks).toHaveLength(0);
	});

	test("execute with stream uses sessionId from context", async () => {
		const { worker, storage } = createWorker();
		worker.init(sampleContext({ sessionId: "custom-session" }));

		await worker.execute("test", () => {});

		const logs = storage.getRawLogs("custom-session");
		expect(logs.length).toBeGreaterThanOrEqual(1);
	});

	test("execute non-stream uses sessionId from context", async () => {
		const { worker, storage } = createWorker({ chatResponse: "result" });
		worker.init(sampleContext({ sessionId: "nonstream-session" }));

		await worker.execute("test");

		const logs = storage.getRawLogs("nonstream-session");
		expect(logs.length).toBeGreaterThanOrEqual(1);
	});
});
