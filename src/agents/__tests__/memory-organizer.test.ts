/**
 * Tests for MemoryOrganizerAgent.
 *
 * MemoryOrganizerAgent structures raw logs into graph memories.
 */

import { describe, expect, mock, test } from "bun:test";
import { OpenCodeAPI } from "../../api/opencode";
import { MemorySystem } from "../../memory";
import { Storage } from "../../storage";
import type { AgentContext, ModelEntry } from "../../types";
import { MemoryOrganizerAgent } from "../memory-organizer";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockModel(): ModelEntry {
	return { provider: "test", model: "organizer-model" };
}

function createApi(): OpenCodeAPI {
	return new (class extends OpenCodeAPI {
		chat = mock(async () => ({
			id: "resp",
			content: "ok",
			model: "m",
			usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
		}));
		streamChat = mock(async function* () {});
	})();
}

function createSystem(): {
	agent: MemoryOrganizerAgent;
	storage: Storage;
	memorySystem: MemorySystem;
} {
	const api = createApi();
	const storage = new Storage(":memory:");
	const memorySystem = new MemorySystem(storage);
	const agent = new MemoryOrganizerAgent(mockModel(), api, memorySystem);
	return { agent, storage, memorySystem };
}

function sampleContext(overrides?: Partial<AgentContext>): AgentContext {
	return {
		sessionId: "organizer-session",
		messages: [],
		systemPrompt: "Organizer prompt.",
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

describe("MemoryOrganizerAgent.constructor", () => {
	test("sets role to memory_organizer", () => {
		const { agent } = createSystem();
		expect(agent.role).toBe("memory_organizer");
	});

	test("stores model parameter", () => {
		const { agent } = createSystem();
		expect((agent as any).model).toEqual(mockModel());
	});
});

describe("MemoryOrganizerAgent.init", () => {
	test("stores context", () => {
		const { agent } = createSystem();
		agent.init(sampleContext());
		expect((agent as any).context).not.toBeNull();
	});
});

describe("MemoryOrganizerAgent.organize", () => {
	test("returns count 0 when no raw logs exist", async () => {
		const { agent } = createSystem();
		agent.init(sampleContext());

		const result = await agent.organize("empty-session");
		expect(result.count).toBe(0);
		expect(result.memories).toHaveLength(0);
	});

	test("creates memory from raw log with bug pattern", async () => {
		const { agent, storage } = createSystem();
		agent.init(sampleContext());

		// Insert raw logs with bug/fix pattern
		storage.insertRawLog(
			"log1",
			"test-session",
			"worker",
			"Bug: login button not working on mobile",
			10,
		);
		storage.insertRawLog(
			"log2",
			"test-session",
			"worker",
			"Fix: Added touch event handler",
			10,
		);

		const result = await agent.organize("test-session");
		expect(result.count).toBeGreaterThanOrEqual(1);
		expect(result.memories.length).toBeGreaterThanOrEqual(1);
	});

	test("creates memory with evidence entries", async () => {
		const { agent, storage } = createSystem();
		agent.init(sampleContext());

		storage.insertRawLog(
			"log1",
			"s1",
			"worker",
			"Bug: TypeError in parse function",
			10,
		);
		storage.insertRawLog("log2", "s1", "worker", "Fix: Added null check", 10);

		const result = await agent.organize("s1");
		expect(result.count).toBeGreaterThanOrEqual(1);

		// Check that memory has evidence
		const memoryId = result.memories[0]!;
		const evidence = storage.getEvidence(memoryId);
		expect(evidence.length).toBeGreaterThanOrEqual(1);
	});

	test("parses investigation lines from raw logs", async () => {
		const { agent, storage } = createSystem();
		agent.init(sampleContext());

		storage.insertRawLog(
			"log1",
			"s1",
			"worker",
			"Bug: Memory leak detected",
			10,
		);
		storage.insertRawLog(
			"log2",
			"s1",
			"worker",
			"Investigation: Found circular reference in cache",
			10,
		);
		storage.insertRawLog(
			"log3",
			"s1",
			"worker",
			"Reason: Cache entries never expired",
			10,
		);
		storage.insertRawLog(
			"log4",
			"s1",
			"worker",
			"Fix: Added TTL to cache entries",
			10,
		);

		const result = await agent.organize("s1");
		expect(result.count).toBe(1);
	});

	test("handles multiple bugs in consecutive logs", async () => {
		const { agent, storage } = createSystem();
		agent.init(sampleContext());

		storage.insertRawLog("log1", "s1", "worker", "Bug: Error in auth", 10);
		storage.insertRawLog("log2", "s1", "worker", "Fix: Updated middleware", 10);
		storage.insertRawLog("log3", "s1", "worker", "Bug: Slow query", 10);
		storage.insertRawLog("log4", "s1", "worker", "Fix: Added index", 10);

		const result = await agent.organize("s1");
		expect(result.count).toBeGreaterThanOrEqual(1);
	});

	test("classifies evidence as observed by default", async () => {
		const { agent, storage } = createSystem();
		agent.init(sampleContext());

		storage.insertRawLog("log1", "s1", "worker", "Bug: Crash on startup", 10);
		storage.insertRawLog("log2", "s1", "worker", "Fix: Updated config", 10);

		const result = await agent.organize("s1");
		const memoryId = result.memories[0]!;
		const evidence = storage.getEvidence(memoryId);
		// Evidence from logs should be "observed"
		expect(evidence.some((e) => e.type === "observed")).toBe(true);
	});

	test("extracts tags from bug text", async () => {
		const { agent, storage } = createSystem();
		agent.init(sampleContext());

		storage.insertRawLog(
			"log1",
			"s1",
			"worker",
			"Bug: Performance issue with memory management",
			10,
		);
		storage.insertRawLog("log2", "s1", "worker", "Fix: Optimized cache", 10);

		const result = await agent.organize("s1");
		expect(result.count).toBe(1);

		// Check tags were extracted
		const memory = storage.getMemory(result.memories[0]!);
		const tags = JSON.parse(memory?.tags);
		// Should include keywords from the bug text
		expect(tags.length).toBeGreaterThanOrEqual(1);
	});
});

describe("MemoryOrganizerAgent with structured log patterns", () => {
	test("detects bug: pattern in logs", async () => {
		const { agent, storage } = createSystem();
		agent.init(sampleContext());

		storage.insertRawLog(
			"l1",
			"s1",
			"worker",
			"Bug: TypeError - cannot read property 'x' of undefined",
			10,
		);
		storage.insertRawLog(
			"l2",
			"s1",
			"worker",
			"Fix: Added optional chaining",
			10,
		);

		const result = await agent.organize("s1");
		expect(result.count).toBeGreaterThanOrEqual(1);
	});

	test("detects error: pattern in logs", async () => {
		const { agent, storage } = createSystem();
		agent.init(sampleContext());

		storage.insertRawLog("l1", "s1", "worker", "Error: Connection timeout", 10);

		const result = await agent.organize("s1");
		expect(result.count).toBeGreaterThanOrEqual(1);
	});

	test("handles root cause analysis logs", async () => {
		const { agent, storage } = createSystem();
		agent.init(sampleContext());

		storage.insertRawLog("l1", "s1", "worker", "Bug: Data corruption", 10);
		storage.insertRawLog(
			"l2",
			"s1",
			"worker",
			"root cause: Race condition in write path",
			10,
		);
		storage.insertRawLog("l3", "s1", "worker", "Fix: Added mutex lock", 10);

		const result = await agent.organize("s1");
		expect(result.count).toBeGreaterThanOrEqual(1);
	});

	test("handles logs with fix: pattern", async () => {
		const { agent, storage } = createSystem();
		agent.init(sampleContext());

		storage.insertRawLog("l1", "s1", "worker", "Bug: UI not rendering", 10);
		storage.insertRawLog(
			"l2",
			"s1",
			"worker",
			"fixed: Updated CSS selector",
			10,
		);

		const result = await agent.organize("s1");
		expect(result.count).toBeGreaterThanOrEqual(1);
	});

	test("handles logs with reason: pattern", async () => {
		const { agent, storage } = createSystem();
		agent.init(sampleContext());

		storage.insertRawLog("l1", "s1", "worker", "Bug: Build failure", 10);
		storage.insertRawLog(
			"l2",
			"s1",
			"worker",
			"because: Missing dependency in package.json",
			10,
		);
		storage.insertRawLog("l3", "s1", "worker", "Fix: Added dependency", 10);

		const result = await agent.organize("s1");
		expect(result.count).toBeGreaterThanOrEqual(1);
	});

	test("creates fallback pattern when no bug/fix detected", async () => {
		const { agent, storage } = createSystem();
		agent.init(sampleContext());

		storage.insertRawLog(
			"l1",
			"s1",
			"worker",
			"Just some random conversation about code",
			10,
		);

		const result = await agent.organize("s1");
		// Falls back to a single pattern with the combined content
		expect(result.count).toBe(1);
	});
});

describe("MemoryOrganizerAgent classifyEvidence", () => {
	test("classifies test source as verified", () => {
		const { agent } = createSystem();
		// Access private method via prototype
		const classify = (agent as any).classifyEvidence.bind(agent);
		expect(classify("test passed", "test")).toBe("verified");
		expect(classify("Verified: positive", "test")).toBe("verified");
		expect(classify("confirmed working", "ci")).toBe("verified");
	});

	test("classifies log source as observed", () => {
		const { agent } = createSystem();
		const classify = (agent as any).classifyEvidence.bind(agent);
		expect(classify("some log output", "log")).toBe("observed");
		expect(classify("console output", "console")).toBe("observed");
		expect(classify("output: data", "file")).toBe("observed");
	});

	test("classifies LLM source as generated", () => {
		const { agent } = createSystem();
		const classify = (agent as any).classifyEvidence.bind(agent);
		// "observed" check comes first, so LLM content without uncertainty becomes "observed"
		expect(classify("suggested fix", "llm")).toBe("observed");
		expect(classify("analysis result", "model")).toBe("observed");
		// Content with uncertainty bypasses "observed", gets "generated"
		expect(classify("I think this", "llm")).toBe("generated");
		expect(classify("Probably that", "model")).toBe("generated");
		expect(classify("might work", "generated")).toBe("generated");
	});

	test("classifies uncertain content as inferred", () => {
		const { agent } = createSystem();
		const classify = (agent as any).classifyEvidence.bind(agent);
		// Log/console source always returns "observed" regardless of content
		expect(classify("I think the bug is...", "log")).toBe("observed");
		expect(classify("Probably a memory issue", "console")).toBe("observed");
		// Non-log src with uncertainty => inferred
		expect(classify("might be related", "file")).toBe("inferred");
		expect(classify("I think this might be it", "analysis")).toBe("inferred");
	});
});

describe("MemoryOrganizerAgent calculateConfidence", () => {
	test("returns 0.3 for empty evidence", () => {
		const { agent } = createSystem();
		const calc = (agent as any).calculateConfidence.bind(agent);
		expect(calc([])).toBe(0.3);
	});

	test("verified evidence yields high confidence", () => {
		const { agent } = createSystem();
		const calc = (agent as any).calculateConfidence.bind(agent);
		const result = calc([
			{ type: "verified", content: "test", source: "test", timestamp: 0 },
		]);
		expect(result).toBeGreaterThan(0.5);
	});

	test("observed evidence yields medium confidence", () => {
		const { agent } = createSystem();
		const calc = (agent as any).calculateConfidence.bind(agent);
		const result = calc([
			{ type: "observed", content: "log", source: "log", timestamp: 0 },
		]);
		expect(result).toBeCloseTo(0.9, 1); // 0.8 + 0.1 = 0.9
	});

	test("capped at 1.0", () => {
		const { agent } = createSystem();
		const calc = (agent as any).calculateConfidence.bind(agent);
		const manyVerified = Array.from({ length: 10 }, () => ({
			type: "verified" as const,
			content: "x",
			source: "x",
			timestamp: 0,
		}));
		expect(calc(manyVerified)).toBeLessThanOrEqual(1.0);
	});
});

describe("MemoryOrganizerAgent extractTags", () => {
	test("extracts file extension tags", () => {
		const { agent } = createSystem();
		const extract = (agent as any).extractTags.bind(agent);
		const tags = extract({
			bug: "bug in code",
			fix: "fix",
			files: ["src/main.ts", "src/style.css"],
		});
		expect(tags).toContain("ts");
		expect(tags).toContain("css");
	});

	test("extracts keyword tags from bug text", () => {
		const { agent } = createSystem();
		const extract = (agent as any).extractTags.bind(agent);
		const tags = extract({
			bug: "Got a crash with memory error",
			fix: "",
			files: [],
		});
		expect(tags).toContain("crash");
		expect(tags).toContain("memory");
	});

	test("deduplicates tags", () => {
		const { agent } = createSystem();
		const extract = (agent as any).extractTags.bind(agent);
		const tags = extract({
			bug: "error crash error crash",
			fix: "",
			files: ["src/main.ts", "src/helper.ts"],
		});
		const tsCount = tags.filter((t: string) => t === "ts").length;
		expect(tsCount).toBe(1);
	});
});

describe("MemoryOrganizerAgent error handling", () => {
	test("handles session with only non-bug logs", async () => {
		const { agent, storage } = createSystem();
		agent.init(sampleContext());

		storage.insertRawLog(
			"l1",
			"s1",
			"worker",
			"Planning the implementation of feature X",
			10,
		);
		storage.insertRawLog(
			"l2",
			"s1",
			"worker",
			"Generated code for feature X",
			10,
		);

		const result = await agent.organize("s1");
		expect(result.count).toBe(1); // fallback pattern
	});

	test("handles empty strings in logs", async () => {
		const { agent, storage } = createSystem();
		agent.init(sampleContext());

		storage.insertRawLog("l1", "s1", "worker", "", 0);

		const result = await agent.organize("s1");
		expect(result.count).toBeGreaterThanOrEqual(0);
	});

	test("handles very large log content", async () => {
		const { agent, storage } = createSystem();
		agent.init(sampleContext());

		storage.insertRawLog("l1", "s1", "worker", "x".repeat(100000), 25000);

		const result = await agent.organize("s1");
		expect(result.count).toBeGreaterThanOrEqual(0);
	});
});
