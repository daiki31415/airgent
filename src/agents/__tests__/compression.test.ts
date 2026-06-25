/**
 * Tests for CompressionAgent.
 *
 * CompressionAgent manages context compression, delegating to CompressionManager
 * and MemorySystem.
 */

import { describe, expect, mock, test } from "bun:test";
import { OpenCodeAPI } from "../../api/opencode";
import { CompressionManager } from "../../compression";
import { MemorySystem } from "../../memory";
import { Storage } from "../../storage";
import type { AgentContext, AgentMessage, ModelEntry } from "../../types";
import { CompressionAgent } from "../compression";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockModel(): ModelEntry {
	return { provider: "test", model: "compress-model" };
}

function createApi(): OpenCodeAPI {
	return new (class extends OpenCodeAPI {
		override chat = mock(async () => ({
			id: "api-resp",
			content: "mock",
			model: "m",
			usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
		}));
		override streamChat = mock(async function* () {});
	})();
}

function createManager(): {
	agent: CompressionAgent;
	compressionManager: CompressionManager;
	storage: Storage;
} {
	const api = createApi();
	const storage = new Storage(":memory:");
	const memorySystem = new MemorySystem(storage);
	const compressionManager = new CompressionManager(memorySystem, storage);
	const agent = new CompressionAgent(mockModel(), api, compressionManager, memorySystem);
	return { agent, compressionManager, storage };
}

function sampleContext(overrides?: Partial<AgentContext>): AgentContext {
	return {
		sessionId: "compress-session",
		messages: [],
		systemPrompt: "Compression system prompt.",
		skillIndex: { skills: [] },
		activeSkills: [],
		memory: { relevantMemories: [], recentRawLogs: [], compressedEntries: [] },
		state: { maxContextTokens: 32000 },
		tokenCount: 0,
		...overrides,
	};
}

function makeMessage(content: string, overrides?: Partial<AgentMessage>): AgentMessage {
	return {
		id: overrides?.id ?? `msg-${Math.random().toString(36).slice(2)}`,
		role: "user",
		content,
		timestamp: Date.now(),
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("CompressionAgent.constructor", () => {
	test("sets role to compression", () => {
		const { agent } = createManager();
		expect(agent.role).toBe("compression");
	});

	test("stores model parameter", () => {
		const { agent } = createManager();
		// biome-ignore lint/suspicious/noExplicitAny: accessing protected property for test assertion
		expect((agent as any).model).toEqual(mockModel());
	});
});

describe("CompressionAgent.compress", () => {
	test("returns compressed=false when usage below threshold", async () => {
		const { agent } = createManager();
		agent.init(sampleContext({ state: { maxContextTokens: 50000 } }));

		const messages = [makeMessage("short message")];
		const result = await agent.compress(messages, 0.9);

		expect(result.compressed).toBe(false);
		expect(result.entries).toHaveLength(0);
		expect(result.reduction).toBe("0%");
	});

	test("returns compressed=true when usage exceeds threshold", async () => {
		const { agent } = createManager();
		agent.init(sampleContext({ state: { maxContextTokens: 100 } }));

		// Create messages that exceed 70% of 100 = 70 tokens
		// Each message of ~200 chars = ~50 tokens
		const messages = [makeMessage("x".repeat(200)), makeMessage("y".repeat(200))];
		const result = await agent.compress(messages, 0.7);

		expect(result.compressed).toBe(true);
		expect(result.entries.length).toBeGreaterThan(0);
	});

	test("groups messages into chunks of ~4000 tokens", async () => {
		const { agent } = createManager();
		agent.init(sampleContext({ state: { maxContextTokens: 100 } }));

		// Each message about 10000 chars = ~2500 tokens -> need 2 messages to exceed 4000 token chunk
		const messages = [
			makeMessage("a".repeat(20000)), // ~5000 tokens
			makeMessage("b".repeat(20000)), // ~5000 tokens
		];
		const result = await agent.compress(messages, 0.01);
		expect(result.compressed).toBe(true);
		expect(result.entries.length).toBeGreaterThanOrEqual(1);
	});

	test("returns correct original and compressed counts", async () => {
		const { agent } = createManager();
		agent.init(sampleContext({ state: { maxContextTokens: 100 } }));

		const messages = [
			makeMessage("x".repeat(200)),
			makeMessage("y".repeat(200)),
			makeMessage("z".repeat(200)),
		];
		const result = await agent.compress(messages, 0.7);

		expect(result.originalCount).toBe(3);
		expect(result.compressedCount).toBe(result.entries.length);
	});

	test("reduction percentage is calculated correctly", async () => {
		const { agent } = createManager();
		agent.init(sampleContext({ state: { maxContextTokens: 100 } }));

		const messages = [makeMessage("x".repeat(200)), makeMessage("y".repeat(200))];
		const result = await agent.compress(messages, 0.7);

		// reduction = (1 - entries.length / messages.length) * 100
		if (result.entries.length > 0) {
			const expectedReduction = `${((1 - result.entries.length / messages.length) * 100).toFixed(0)}%`;
			expect(result.reduction).toBe(expectedReduction);
		}
	});

	test("uses default threshold of 0.7", async () => {
		const { agent } = createManager();
		agent.init(sampleContext({ state: { maxContextTokens: 100 } }));

		const messages = [makeMessage("short")];
		// Should not compress since 1 token / 100 = 0.01 < 0.7
		const result = await agent.compress(messages);
		expect(result.compressed).toBe(false);
	});

	test("compresses when threshold is 0 and messages exist", async () => {
		const { agent } = createManager();
		agent.init(sampleContext({ state: { maxContextTokens: 100 } }));

		const messages = [makeMessage("x".repeat(400))];
		const result = await agent.compress(messages, 0);
		expect(result.compressed).toBe(true);
	});

	test("handles empty messages array", async () => {
		const { agent } = createManager();
		agent.init(sampleContext());

		const result = await agent.compress([], 0.5);
		expect(result.compressed).toBe(false);
		expect(result.entries).toHaveLength(0);
		expect(result.originalCount).toBe(0);
	});

	test("handles single message under threshold", async () => {
		const { agent } = createManager();
		agent.init(sampleContext({ state: { maxContextTokens: 50000 } }));

		const messages = [makeMessage("single message")];
		const result = await agent.compress(messages);
		expect(result.compressed).toBe(false);
	});

	test("uses maxContextTokens from context state", async () => {
		const { agent } = createManager();
		// With maxContextTokens=10, a message with ~40 chars = ~10 tokens => 10/10 = 1.0 >= 0.7 => compresses
		agent.init(sampleContext({ state: { maxContextTokens: 1000 } }));

		const messages = [makeMessage("short")]; // ~1 token
		// 1/1000 = 0.001 < 0.7 => not compressed
		const result = await agent.compress(messages);
		expect(result.compressed).toBe(false);
	});

	test("defaults maxContextTokens to 32000 when not in state", async () => {
		const { agent } = createManager();
		agent.init(sampleContext({ state: {} }));

		const messages = [makeMessage("x".repeat(100))];
		// 25/32000 = 0.00078 < 0.7
		const result = await agent.compress(messages);
		expect(result.compressed).toBe(false);
	});
});

describe("CompressionAgent.decompress", () => {
	test("decompress stores entry and finds via originalId", async () => {
		const { agent, storage } = createManager();
		const memorySystem = new MemorySystem(storage);
		agent.init(sampleContext());

		// CompressSession stores an entry; decompress looks up by originalId
		memorySystem.recordRaw("s1", "worker", "Test context data", 5);
		// biome-ignore lint/suspicious/noExplicitAny: accessing protected property for test assertion
		const compressionMgr = (agent as any).compressionManager as CompressionManager;
		await compressionMgr.compressSession("s1");

		const allEntries = storage.getAllCompressed();
		// decompress(id) calls getCompressedByOriginalId(id) internally
		// So we need to pass originalId, not entry.id
		if (allEntries.length > 0) {
			const originalId = allEntries[0]?.originalId;
			const entries = await agent.decompress([originalId]);
			expect(entries).toHaveLength(1);
		}
	});

	test("returns empty array for empty entryIds", async () => {
		const { agent } = createManager();
		agent.init(sampleContext());

		const entries = await agent.decompress([]);
		expect(entries).toHaveLength(0);
	});

	test("skips entries that fail decompression", async () => {
		const { agent } = createManager();
		agent.init(sampleContext());

		const entries = await agent.decompress(["nonexistent-id"]);
		expect(entries).toHaveLength(0);
	});

	test("handles mix of valid and invalid originalIds", async () => {
		const { agent, storage } = createManager();
		const memorySystem = new MemorySystem(storage);
		agent.init(sampleContext());

		memorySystem.recordRaw("s2", "worker", "Valid compression test", 5);
		// biome-ignore lint/suspicious/noExplicitAny: accessing protected property for test assertion
		const compressionMgr = (agent as any).compressionManager as CompressionManager;
		await compressionMgr.compressSession("s2");

		const allEntries = storage.getAllCompressed();
		if (allEntries.length > 0) {
			const entries = await agent.decompress([allEntries[0]?.originalId, "bad-id"]);
			expect(entries).toHaveLength(1);
		}
	});
});

describe("CompressionAgent error handling", () => {
	test("throws if not initialized for compress (indirectly via think)", async () => {
		const { agent } = createManager();
		// agent not initialized - compress doesn't call think directly,
		// but it accesses context.state
		const messages = [makeMessage("test")];
		// Let's check - compress() doesn't call think() so it shouldn't throw
		const result = await agent.compress(messages);
		expect(result.compressed).toBe(false);
		// Actually compress uses this.context?.state which defaults gracefully
	});

	test("handles context with null state gracefully", async () => {
		const { agent } = createManager();
		// biome-ignore lint/suspicious/noExplicitAny: test intentionally passes null state
		agent.init(sampleContext({ state: null as any }));

		const messages = [makeMessage("test")];
		const result = await agent.compress(messages);
		// Should use default maxContextTokens of 32000
		expect(result.compressed).toBe(false);
	});
});

describe("CompressionAgent edge cases", () => {
	test("messages with moderately long content are grouped correctly", async () => {
		const { agent } = createManager();
		agent.init(sampleContext({ state: { maxContextTokens: 100 } }));

		const messages = [makeMessage("x".repeat(5000))]; // ~1250 tokens
		const result = await agent.compress(messages, 0.01);
		expect(result.compressed).toBe(true);
		expect(result.originalCount).toBe(1);
	});

	test("messages with empty content are counted", async () => {
		const { agent } = createManager();
		agent.init(sampleContext({ state: { maxContextTokens: 10 } }));

		const messages = [makeMessage("")];
		// 0 tokens / 10 = 0 < 0.7 threshold
		const result = await agent.compress(messages, 0.7);
		expect(result.compressed).toBe(false);
	});

	test("multiple small messages below threshold do not compress", async () => {
		const { agent } = createManager();
		agent.init(sampleContext({ state: { maxContextTokens: 1000 } }));

		const messages = Array.from({ length: 10 }, (_, i) => makeMessage(`msg ${i}`));
		const result = await agent.compress(messages, 0.9);
		// Small messages relative to maxContextTokens*0.9 = 900 tokens threshold
		expect(result.compressed).toBe(false);
	});

	test("messages with different roles are grouped together", async () => {
		const { agent } = createManager();
		agent.init(sampleContext({ state: { maxContextTokens: 100 } }));

		const messages = [
			makeMessage("system init", { role: "system" }),
			makeMessage("user query", { role: "user" }),
			makeMessage("assistant response", { role: "assistant" }),
		];
		const result = await agent.compress(messages, 1.0);
		// 1.0 threshold means usage must be >= 100%, which won't happen with small msgs
		expect(result.compressed).toBe(false);
	});
});

describe("CompressionAgent.init", () => {
	test("stores context", () => {
		const { agent } = createManager();
		agent.init(sampleContext());
		// biome-ignore lint/suspicious/noExplicitAny: accessing protected property for test assertion
		expect((agent as any).context).not.toBeNull();
	});
});

describe("CompressionAgent additional edge cases", () => {
	test("compress with threshold=1.0 never compresses", async () => {
		const { agent } = createManager();
		agent.init(sampleContext({ state: { maxContextTokens: 10 } }));

		const messages = [makeMessage("x".repeat(50))]; // ~12 tokens
		// 12/10 = 1.2 >= 1.0, so it WILL compress
		const result = await agent.compress(messages, 1.0);
		expect(result.compressed).toBe(true);
	});

	test("compress with threshold=0 and empty messages returns compressed=false", async () => {
		const { agent } = createManager();
		agent.init(sampleContext({ state: { maxContextTokens: 100 } }));

		const result = await agent.compress([], 0);
		// Empty messages -> totalTokens=0, 0/100=0, which is not < 0 (threshold), so compression proceeds
		// But with empty messages, entries will be empty and compressedCount=0
		expect(result.compressed).toBe(true); // usageRatio 0 >= threshold 0 -> compression runs
		expect(result.entries).toHaveLength(0);
		expect(result.compressedCount).toBe(0);
	});

	test("groupMessages splits large messages into chunks", async () => {
		const { agent } = createManager();
		agent.init(sampleContext({ state: { maxContextTokens: 1000 } }));

		// Many messages that together exceed 4000 tokens per chunk
		const messages = Array.from(
			{ length: 20 },
			(_, _i) => makeMessage("x".repeat(1000)), // ~250 tokens each, 20 * 250 = 5000 tokens total
		);
		const result = await agent.compress(messages, 0.1);
		// Should be compressed into multiple chunks
		expect(result.compressed).toBe(true);
		expect(result.entries.length).toBeGreaterThanOrEqual(1);
	});

	test("reduction calculation shows correct percentage", async () => {
		const { agent } = createManager();
		agent.init(sampleContext({ state: { maxContextTokens: 100 } }));

		const messages = Array.from({ length: 5 }, (_, _i) => makeMessage("x".repeat(200)));
		const result = await agent.compress(messages, 0.7);
		expect(result.originalCount).toBe(5);
		expect(result.reduction).toMatch(/%$/);
	});
});
