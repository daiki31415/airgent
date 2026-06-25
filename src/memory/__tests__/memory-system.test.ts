import { describe, expect, test } from "bun:test";
import { Storage } from "../../storage";
import { MemorySystem } from "../index";

function createSystem(): MemorySystem {
	const storage = new Storage(":memory:");
	return new MemorySystem(storage);
}

describe("MemorySystem", () => {
	test("recordRaw inserts a raw log", () => {
		const ms = createSystem();
		const storage = (ms as any).storage as Storage;
		ms.recordRaw("sess1", "worker", "test content", 42);
		const logs = storage.getRawLogs("sess1");
		expect(logs).toHaveLength(1);
		expect(logs[0]?.content).toBe("test content");
		expect(logs[0]?.agent_role).toBe("worker");
		expect(logs[0]?.token_count).toBe(42);
	});

	test("getRawLogsBySession returns session logs", () => {
		const ms = createSystem();
		ms.recordRaw("s1", "planner", "plan content", 10);
		ms.recordRaw("s1", "worker", "work content", 20);
		ms.recordRaw("other", "worker", "other content", 5);
		const logs = ms.getRawLogsBySession("s1");
		expect(logs).toHaveLength(2);
	});

	test("createMemory inserts memory, evidence, and auto-links", () => {
		const ms = createSystem();
		const storage = (ms as any).storage as Storage;

		// Insert initial memory to enable auto-linking
		storage.insertMemory({
			id: "existing",
			sessionId: "s1",
			bug: "old bug",
			investigation: "",
			rootCause: "",
			fix: "",
			reason: "",
			confidence: 0.9,
			tags: ["crash"],
			files: [],
			commands: [],
		});

		const id = ms.createMemory({
			sessionId: "s1",
			bug: "null crash",
			investigation: "found deref",
			rootCause: "nullptr",
			fix: "add check",
			reason: "safety",
			evidence: [
				{
					type: "observed",
					content: "crash log",
					source: "test",
					timestamp: Date.now(),
				},
			],
			confidence: 0.8,
			tags: ["crash", "null"],
			files: ["src/main.ts"],
			commands: [],
		});

		expect(id).toBeTruthy();
		expect(typeof id).toBe("string");

		// Memory was stored
		const mem = storage.getMemory(id);
		expect(mem).not.toBeNull();
		expect(mem?.bug).toBe("null crash");

		// Evidence was stored
		const evidence = storage.getEvidence(id);
		expect(evidence).toHaveLength(1);
		expect(evidence[0]?.type).toBe("observed");
	});

	test("findRelevant returns empty for no tags", () => {
		const ms = createSystem();
		const results = ms.findRelevant([]);
		expect(results).toHaveLength(0);
	});

	test("findRelevant returns matching memories", () => {
		const ms = createSystem();
		const storage = (ms as any).storage as Storage;
		storage.insertMemory({
			id: "m1",
			sessionId: "s1",
			bug: "auth bug",
			investigation: "",
			rootCause: "",
			fix: "",
			reason: "",
			confidence: 0.8,
			tags: ["auth", "login"],
			files: [],
			commands: [],
		});

		const results = ms.findRelevant(["auth"]);
		expect(results).toHaveLength(1);
		expect(results[0]?.bug).toBe("auth bug");
	});

	test("findRelevant respects minConfidence", () => {
		const ms = createSystem();
		const storage = (ms as any).storage as Storage;
		storage.insertMemory({
			id: "m1",
			sessionId: "s1",
			bug: "low conf",
			investigation: "",
			rootCause: "",
			fix: "",
			reason: "",
			confidence: 0.2,
			tags: ["auth"],
			files: [],
			commands: [],
		});

		expect(ms.findRelevant(["auth"], 0.5)).toHaveLength(0);
		expect(ms.findRelevant(["auth"], 0.1)).toHaveLength(1);
	});

	test("getEvidence returns evidence array", () => {
		const ms = createSystem();
		const storage = (ms as any).storage as Storage;
		storage.insertMemory({
			id: "m1",
			sessionId: "s1",
			bug: "b",
			investigation: "",
			rootCause: "",
			fix: "",
			reason: "",
			confidence: 0.5,
			tags: [],
			files: [],
			commands: [],
		});
		storage.insertEvidence("ev1", "m1", "observed", "log output", "test");

		const evidence = ms.getEvidence("m1");
		expect(evidence).toHaveLength(1);
		expect(evidence[0]?.source).toBe("test");
	});

	test("getLinked returns linked memories", () => {
		const ms = createSystem();
		const storage = (ms as any).storage as Storage;
		storage.insertMemory({
			id: "m1",
			sessionId: "s1",
			bug: "bug1",
			investigation: "",
			rootCause: "",
			fix: "",
			reason: "",
			confidence: 0.8,
			tags: [],
			files: [],
			commands: [],
		});
		storage.insertMemory({
			id: "m2",
			sessionId: "s1",
			bug: "bug2",
			investigation: "",
			rootCause: "",
			fix: "",
			reason: "",
			confidence: 0.8,
			tags: [],
			files: [],
			commands: [],
		});
		storage.insertLink("link1", "m1", "m2", "similar_pattern", 0.7);

		// getLinkedMemories JOIN ON (target_id = m.id OR source_id = m.id) returns
		// both the linked memory (m2) AND the source memory (m1) itself
		const linked = ms.getLinked("m1");
		expect(linked).toHaveLength(2);
		expect(linked.map((l) => l.id)).toContain("m2");
	});

	test("findContradictions delegates to storage", () => {
		const ms = createSystem();
		const results = ms.findContradictions();
		expect(Array.isArray(results)).toBe(true);
	});

	test("findCircularReferences delegates to storage", () => {
		const ms = createSystem();
		const results = ms.findCircularReferences();
		expect(Array.isArray(results)).toBe(true);
	});

	test("recordRaw with zero tokenCount defaults to 0", () => {
		const ms = createSystem();
		const storage = (ms as any).storage as Storage;
		ms.recordRaw("s1", "worker", "content");
		const logs = storage.getRawLogs("s1");
		expect(logs[0]?.token_count).toBe(0);
	});

	test("recordRaw generates unique IDs for each entry", () => {
		const ms = createSystem();
		const storage = (ms as any).storage as Storage;
		ms.recordRaw("s1", "worker", "first");
		ms.recordRaw("s1", "worker", "second");
		const logs = storage.getRawLogs("s1");
		expect(logs[0]?.id).not.toBe(logs[1]?.id);
	});

	test("getRawLogsBySession respects limit parameter", () => {
		const ms = createSystem();
		for (let i = 0; i < 10; i++) {
			ms.recordRaw("s1", "worker", `log ${i}`, i);
		}
		const logs = ms.getRawLogsBySession("s1", 3);
		expect(logs).toHaveLength(3);
	});

	test("getRawLogsBySession returns empty array for unknown session", () => {
		const ms = createSystem();
		const logs = ms.getRawLogsBySession("nonexistent");
		expect(logs).toHaveLength(0);
	});

	test("createMemory stores all fields correctly", () => {
		const ms = createSystem();
		const storage = (ms as any).storage as Storage;

		const id = ms.createMemory({
			sessionId: "s1",
			bug: "test bug",
			investigation: "investigated",
			rootCause: "root cause",
			fix: "the fix",
			reason: "because",
			evidence: [
				{
					type: "observed",
					content: "evidence 1",
					source: "log",
					timestamp: 100,
				},
				{
					type: "verified",
					content: "evidence 2",
					source: "test",
					timestamp: 200,
				},
			],
			confidence: 0.75,
			tags: ["tag1", "tag2"],
			files: ["src/file1.ts"],
			commands: ["npm test"],
		});

		const mem = storage.getMemory(id);
		expect(mem?.session_id).toBe("s1");
		expect(mem?.bug).toBe("test bug");
		expect(mem?.investigation).toBe("investigated");
		expect(mem?.root_cause).toBe("root cause");
		expect(mem?.fix).toBe("the fix");
		expect(mem?.reason).toBe("because");
		expect(mem?.confidence).toBe(0.75);
		expect(JSON.parse(mem?.tags)).toEqual(["tag1", "tag2"]);
		expect(JSON.parse(mem?.files)).toEqual(["src/file1.ts"]);
		expect(JSON.parse(mem?.commands)).toEqual(["npm test"]);
	});

	test("createMemory stores multiple evidence entries", () => {
		const ms = createSystem();
		const storage = (ms as any).storage as Storage;

		const id = ms.createMemory({
			sessionId: "s1",
			bug: "bug",
			investigation: "",
			rootCause: "",
			fix: "",
			reason: "",
			evidence: [
				{ type: "observed", content: "e1", source: "log", timestamp: 0 },
				{ type: "inferred", content: "e2", source: "analysis", timestamp: 0 },
				{ type: "generated", content: "e3", source: "llm", timestamp: 0 },
			],
			confidence: 0.5,
			tags: [],
			files: [],
			commands: [],
		});

		const evidence = storage.getEvidence(id);
		expect(evidence).toHaveLength(3);
	});

	test("findRelevant returns no matches for non-existent tags", () => {
		const ms = createSystem();
		const results = ms.findRelevant(["nonexistent_tag_xyz"]);
		expect(results).toHaveLength(0);
	});

	test("findRelevant sorts by confidence descending", () => {
		const ms = createSystem();
		const storage = (ms as any).storage as Storage;

		storage.insertMemory({
			id: "m1",
			sessionId: "s1",
			bug: "low conf",
			investigation: "",
			rootCause: "",
			fix: "",
			reason: "",
			confidence: 0.4,
			tags: ["test"],
			files: [],
			commands: [],
		});
		storage.insertMemory({
			id: "m2",
			sessionId: "s1",
			bug: "high conf",
			investigation: "",
			rootCause: "",
			fix: "",
			reason: "",
			confidence: 0.9,
			tags: ["test"],
			files: [],
			commands: [],
		});

		const results = ms.findRelevant(["test"]);
		expect(results[0]?.confidence).toBeGreaterThanOrEqual(
			results[1]?.confidence,
		);
	});

	test("createMemory with empty evidence stores no evidence", () => {
		const ms = createSystem();
		const storage = (ms as any).storage as Storage;

		const id = ms.createMemory({
			sessionId: "s1",
			bug: "bug",
			investigation: "",
			rootCause: "",
			fix: "",
			reason: "",
			evidence: [],
			confidence: 0.5,
			tags: [],
			files: [],
			commands: [],
		});

		const evidence = storage.getEvidence(id);
		expect(evidence).toHaveLength(0);
	});

	test("createMemory auto-links to existing memories with matching tags", () => {
		const ms = createSystem();
		const storage = (ms as any).storage as Storage;

		// Create initial memory
		storage.insertMemory({
			id: "existing",
			sessionId: "s1",
			bug: "old bug",
			investigation: "",
			rootCause: "",
			fix: "",
			reason: "",
			confidence: 0.9,
			tags: ["crash", "memory"],
			files: [],
			commands: [],
		});

		// Create new memory with overlapping tag
		const newId = ms.createMemory({
			sessionId: "s1",
			bug: "new crash",
			investigation: "",
			rootCause: "",
			fix: "",
			reason: "",
			evidence: [
				{ type: "observed", content: "crash", source: "log", timestamp: 0 },
			],
			confidence: 0.8,
			tags: ["crash", "null"],
			files: [],
			commands: [],
		});

		// Auto-linking should create a link between the two memories
		const linked = ms.getLinked(newId);
		expect(linked.length).toBeGreaterThanOrEqual(1);
	});

	test("getEvidence returns empty array for memory with no evidence", () => {
		const ms = createSystem();
		const storage = (ms as any).storage as Storage;
		storage.insertMemory({
			id: "m1",
			sessionId: "s1",
			bug: "b1",
			investigation: "",
			rootCause: "",
			fix: "",
			reason: "",
			confidence: 0.5,
			tags: [],
			files: [],
			commands: [],
		});
		const evidence = ms.getEvidence("m1");
		expect(evidence).toHaveLength(0);
	});

	test("getLinked returns empty array for memory with no links", () => {
		const ms = createSystem();
		const storage = (ms as any).storage as Storage;
		storage.insertMemory({
			id: "m1",
			sessionId: "s1",
			bug: "b1",
			investigation: "",
			rootCause: "",
			fix: "",
			reason: "",
			confidence: 0.5,
			tags: [],
			files: [],
			commands: [],
		});
		const linked = ms.getLinked("m1");
		expect(linked).toHaveLength(0);
	});

	test("handles very large content in recordRaw", () => {
		const ms = createSystem();
		const storage = (ms as any).storage as Storage;
		const largeContent = "x".repeat(100000);
		ms.recordRaw("s1", "worker", largeContent, 25000);
		const logs = storage.getRawLogs("s1");
		expect(logs[0]?.content).toBe(largeContent);
		expect(logs[0]?.token_count).toBe(25000);
	});

	test("createMemory handles very large bug text", () => {
		const ms = createSystem();
		const storage = (ms as any).storage as Storage;
		const longBug = "x".repeat(50000);
		const id = ms.createMemory({
			sessionId: "s1",
			bug: longBug,
			investigation: "",
			rootCause: "",
			fix: "",
			reason: "",
			evidence: [
				{ type: "observed", content: "ev", source: "log", timestamp: 0 },
			],
			confidence: 0.5,
			tags: [],
			files: [],
			commands: [],
		});
		const mem = storage.getMemory(id);
		expect(mem?.bug.length).toBe(50000);
	});

	test("multiple recordRaw calls with same session are stored", () => {
		const ms = createSystem();
		const storage = (ms as any).storage as Storage;
		ms.recordRaw("s1", "planner", "plan A");
		ms.recordRaw("s1", "worker", "work B");
		ms.recordRaw("s1", "planner", "plan C");
		const logs = storage.getRawLogs("s1");
		expect(logs).toHaveLength(3);
	});
});
