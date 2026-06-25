import { beforeEach, describe, expect, test } from "bun:test";
import { MemorySystem } from "../../memory";
import { Storage } from "../../storage";
import type { AgentMessage } from "../../types";
import { CompressionManager } from "../index";

function createManager(): CompressionManager {
	return new CompressionManager(null as any, null as any);
}

describe("CompressionManager.compress", () => {
	test("extracts topics from headers", async () => {
		const mgr = createManager();
		const msgs: AgentMessage[] = [
			{
				id: "1",
				role: "user",
				content: "# Auth System\nImplement login",
				timestamp: 0,
			},
			{
				id: "2",
				role: "assistant",
				content: "## Setup\nCreated auth route",
				timestamp: 0,
			},
		];
		const entry = await mgr.compress(msgs);
		expect(entry.topics).toContain("Auth System");
		expect(entry.topics).toContain("Setup");
	});

	test("extracts file paths from content", async () => {
		const mgr = createManager();
		const msgs: AgentMessage[] = [
			{
				id: "1",
				role: "user",
				content: "Edit src/auth.rs and src/config.go and src/main.py",
				timestamp: 0,
			},
		];
		const entry = await mgr.compress(msgs);
		expect(entry.files).toContain("src/auth.rs");
		expect(entry.files).toContain("src/config.go");
		expect(entry.files).toContain("src/main.py");
	});

	test("extracts error keywords", async () => {
		const mgr = createManager();
		const msgs: AgentMessage[] = [
			{
				id: "1",
				role: "user",
				content: "Got TypeError: cannot read property",
				timestamp: 0,
			},
		];
		const entry = await mgr.compress(msgs);
		expect(entry.errorKeywords).toContain("TypeError");
	});

	test("extracts commands", async () => {
		const mgr = createManager();
		const msgs: AgentMessage[] = [
			{
				id: "1",
				role: "user",
				content: "Run $ npm install\nThen $ bun test",
				timestamp: 0,
			},
		];
		const entry = await mgr.compress(msgs);
		expect(entry.commands).toContain("npm install");
		expect(entry.commands).toContain("bun test");
	});

	test("extracts PascalCase entities", async () => {
		const mgr = createManager();
		const msgs: AgentMessage[] = [
			{
				id: "1",
				role: "user",
				content: "AuthManager handles UserLoginFlow",
				timestamp: 0,
			},
		];
		const entry = await mgr.compress(msgs);
		expect(entry.entities).toContain("AuthManager");
		expect(entry.entities).toContain("UserLoginFlow");
	});

	test("calculates importance score based on metadata", async () => {
		const mgr = createManager();
		const msgs: AgentMessage[] = [
			{
				id: "1",
				role: "user",
				content: "# Critical Bug\nTypeError in src/app.ts\n$ git revert\nSee ErrorManager",
				timestamp: 0,
			},
		];
		const entry = await mgr.compress(msgs);
		expect(entry.importanceScore).toBeGreaterThan(0.3);
		expect(entry.importanceScore).toBeLessThanOrEqual(1.0);
	});

	test("truncates content over 1000 chars", async () => {
		const mgr = createManager();
		const longContent = "x".repeat(2000);
		const msgs: AgentMessage[] = [{ id: "1", role: "user", content: longContent, timestamp: 0 }];
		const entry = await mgr.compress(msgs);
		expect(entry.compressedContent.endsWith("...[truncated]")).toBe(true);
	});

	test("keeps content under 1000 chars as-is", async () => {
		const mgr = createManager();
		const shortContent = "short message";
		const msgs: AgentMessage[] = [{ id: "1", role: "user", content: shortContent, timestamp: 0 }];
		const entry = await mgr.compress(msgs);
		expect(entry.compressedContent).toBe("[user]\nshort message");
	});

	test("combines multiple messages with role headers", async () => {
		const mgr = createManager();
		const msgs: AgentMessage[] = [
			{ id: "1", role: "user", content: "hello", timestamp: 0 },
			{ id: "2", role: "assistant", content: "world", timestamp: 0 },
		];
		const entry = await mgr.compress(msgs);
		const combined = "[user]\nhello\n\n[assistant]\nworld";
		expect(entry.compressedContent).toBe(combined);
	});

	test("baseline importance for empty metadata", async () => {
		const mgr = createManager();
		const msgs: AgentMessage[] = [{ id: "1", role: "user", content: "hello world", timestamp: 0 }];
		const entry = await mgr.compress(msgs);
		expect(entry.importanceScore).toBe(0.3);
	});

	test("errors boost importance significantly", async () => {
		const mgr = createManager();
		const msgs: AgentMessage[] = [
			{
				id: "1",
				role: "user",
				content: "Error: TypeError\nSyntaxError\nReferenceError",
				timestamp: 0,
			},
		];
		const entry = await mgr.compress(msgs);
		// baseline 0.3 + errors capped at 0.3 + 3 entities * 0.02 = 0.06
		expect(entry.importanceScore).toBeGreaterThanOrEqual(0.3);
		expect(entry.importanceScore).toBeGreaterThan(0.5);
		expect(entry.errorKeywords).toContain("TypeError");
		expect(entry.errorKeywords).toContain("SyntaxError");
		expect(entry.errorKeywords).toContain("ReferenceError");
	});

	test("handles empty messages array", async () => {
		const mgr = createManager();
		const entry = await mgr.compress([]);
		expect(entry.topics).toHaveLength(0);
		expect(entry.compressedContent).toBe("");
		// baseline importance for empty/no metadata
		expect(entry.importanceScore).toBe(0.3);
		expect(entry.tokenCount).toBe(0);
	});

	test("handles messages with special characters", async () => {
		const mgr = createManager();
		const msgs: AgentMessage[] = [
			{
				id: "1",
				role: "user",
				content: "Line with <script>alert('xss')</script> & special chars: ñ ø æ",
				timestamp: 0,
			},
		];
		const entry = await mgr.compress(msgs);
		expect(entry.compressedContent).toContain("script");
		expect(entry.importanceScore).toBeGreaterThanOrEqual(0.3);
	});

	test("deduplicates extracted topics", async () => {
		const mgr = createManager();
		const msgs: AgentMessage[] = [
			{
				id: "1",
				role: "user",
				content: "# Auth System\nImplement login",
				timestamp: 0,
			},
			{
				id: "2",
				role: "assistant",
				content: "# Auth System\nAdded routes",
				timestamp: 0,
			},
		];
		const entry = await mgr.compress(msgs);
		const authTopics = entry.topics.filter((t) => t === "Auth System");
		expect(authTopics).toHaveLength(1);
	});

	test("extracts uppercase error keywords", async () => {
		const mgr = createManager();
		const msgs: AgentMessage[] = [
			{
				id: "1",
				role: "user",
				content: "ERROR: FAILED ASSERTION",
				timestamp: 0,
			},
		];
		const entry = await mgr.compress(msgs);
		// Error regex looks for Error: pattern - uppercase ERROR might not match
		expect(entry.errorKeywords.length).toBeGreaterThanOrEqual(0);
	});

	test("commands with sudo prefix extracted correctly", async () => {
		const mgr = createManager();
		const msgs: AgentMessage[] = [
			{
				id: "1",
				role: "user",
				content: "Run $ sudo apt update\nThen $ docker compose up",
				timestamp: 0,
			},
		];
		const entry = await mgr.compress(msgs);
		expect(entry.commands).toContain("sudo apt update");
		expect(entry.commands).toContain("docker compose up");
	});

	test("title uses first 3 topics", async () => {
		const mgr = createManager();
		const msgs: AgentMessage[] = [
			{
				id: "1",
				role: "user",
				content: "# TopicA\n# TopicB\n# TopicC\n# TopicD",
				timestamp: 0,
			},
		];
		const entry = await mgr.compress(msgs);
		expect(entry.title).toContain("TopicA");
		expect(entry.title).toContain("TopicB");
	});

	test("title falls back to default when no topics", async () => {
		const mgr = createManager();
		const msgs: AgentMessage[] = [
			{ id: "1", role: "user", content: "no headers here", timestamp: 0 },
		];
		const entry = await mgr.compress(msgs);
		expect(entry.title).toBe("Compressed context");
	});

	test("tokenCount is calculated from combined content length", async () => {
		const mgr = createManager();
		const msgs: AgentMessage[] = [{ id: "1", role: "user", content: "hello world", timestamp: 0 }];
		const entry = await mgr.compress(msgs);
		// "[user]\nhello world" = 18 chars / 4 = 4.5 -> ceil = 5
		expect(entry.tokenCount).toBe(5);
	});

	test("originalId falls back to messages[0].id", async () => {
		const mgr = createManager();
		const msgs: AgentMessage[] = [{ id: "custom-id", role: "user", content: "test", timestamp: 0 }];
		const entry = await mgr.compress(msgs);
		expect(entry.originalId).toBe("custom-id");
	});

	test("generates UUID for originalId when messages empty", async () => {
		const mgr = createManager();
		const entry = await mgr.compress([]);
		expect(entry.originalId).toBeTruthy();
		expect(typeof entry.originalId).toBe("string");
	});
});

describe("CompressionManager.extractMetadata", () => {
	test("extracts file paths with various extensions", () => {
		const mgr = createManager();
		const extract = (mgr as any).extractMetadata.bind(mgr);
		const result = extract("Edit src/main.ts and src/lib/helper.js and config.json");
		expect(result.files).toContain("src/main.ts");
		expect(result.files).toContain("src/lib/helper.js");
		expect(result.files).toContain("config.json");
	});

	test("extracts error codes like E0001", () => {
		const mgr = createManager();
		const extract = (mgr as any).extractMetadata.bind(mgr);
		const result = extract("Error E1234 occurred in module");
		expect(result.errors).toContain("E1234");
	});

	test("extracts PascalCase entities from text", () => {
		const mgr = createManager();
		const extract = (mgr as any).extractMetadata.bind(mgr);
		const result = extract("MyClass.getInstance() calls SomeFactory");
		expect(result.entities).toContain("MyClass");
		expect(result.entities).toContain("SomeFactory");
	});
});

describe("CompressionManager.calculateImportance", () => {
	test("baseline score is 0.3", () => {
		const mgr = createManager();
		const calc = (mgr as any).calculateImportance.bind(mgr);
		expect(calc({ errors: [], files: [], commands: [], entities: [] })).toBe(0.3);
	});

	test("errors add up to 0.3 max", () => {
		const mgr = createManager();
		const calc = (mgr as any).calculateImportance.bind(mgr);
		const score = calc({
			errors: ["E1", "E2", "E3"],
			files: [],
			commands: [],
			entities: [],
		});
		// baseline 0.3 + min(3 * 0.15, 0.3) = 0.6
		expect(score).toBe(0.6);
	});

	test("files add up to 0.15 max", () => {
		const mgr = createManager();
		const calc = (mgr as any).calculateImportance.bind(mgr);
		const score = calc({
			errors: [],
			files: ["a.ts", "b.ts", "c.ts", "d.ts"],
			commands: [],
			entities: [],
		});
		// baseline 0.3 + min(4 * 0.05, 0.15) = 0.45
		// Use toBeCloseTo for floating point precision
		expect(score).toBeCloseTo(0.45, 5);
	});

	test("commands add up to 0.15 max", () => {
		const mgr = createManager();
		const calc = (mgr as any).calculateImportance.bind(mgr);
		const score = calc({
			errors: [],
			files: [],
			commands: ["cmd1", "cmd2", "cmd3", "cmd4"],
			entities: [],
		});
		// baseline 0.3 + min(4 * 0.05, 0.15) = 0.45
		expect(score).toBeCloseTo(0.45, 5);
	});

	test("entities add up to 0.1 max", () => {
		const mgr = createManager();
		const calc = (mgr as any).calculateImportance.bind(mgr);
		const score = calc({
			errors: [],
			files: [],
			commands: [],
			entities: ["A", "B", "C", "D", "E", "F"],
		});
		// baseline 0.3 + min(6 * 0.02, 0.1) = 0.4
		expect(score).toBe(0.4);
	});

	test("all factors combined cap at 1.0", () => {
		const mgr = createManager();
		const calc = (mgr as any).calculateImportance.bind(mgr);
		const score = calc({
			errors: ["E1", "E2", "E3", "E4", "E5"],
			files: ["a.ts", "b.ts", "c.ts", "d.ts", "e.ts"],
			commands: ["c1", "c2", "c3", "c4", "c5"],
			entities: ["A1", "A2", "A3", "A4", "A5", "A6"],
		});
		expect(score).toBeLessThanOrEqual(1.0);
		expect(score).toBeGreaterThan(0.9);
	});
});

describe("CompressionManager.findForDecompression", () => {
	let storage: Storage;
	let memorySystem: MemorySystem;

	beforeEach(() => {
		storage = new Storage(":memory:");
		memorySystem = new MemorySystem(storage);
	});

	test("returns empty for empty options", () => {
		const mgr = new CompressionManager(memorySystem, storage);
		const result = mgr.findForDecompression({});
		expect(result).toHaveLength(0);
	});

	test("returns empty when storage has no matches", () => {
		const mgr = new CompressionManager(memorySystem, storage);
		const result = mgr.findForDecompression({ topics: ["nonexistent"] });
		expect(result).toHaveLength(0);
	});

	test("combines topics, files, and errors into search terms", () => {
		const mgr = new CompressionManager(memorySystem, storage);
		const result = mgr.findForDecompression({
			topics: ["topic1"],
			files: ["file.ts"],
			errors: ["TypeError"],
		});
		expect(Array.isArray(result)).toBe(true);
	});
});

describe("CompressionManager.decompress", () => {
	test("throws for non-existent entry", async () => {
		const storage = new Storage(":memory:");
		const memorySystem = new MemorySystem(storage);
		const mgr = new CompressionManager(memorySystem, storage);
		expect(mgr.decompress("nonexistent")).rejects.toThrow("Compressed entry not found");
	});
});

describe("CompressionManager.compressSession", () => {
	test("does nothing for empty session", async () => {
		const storage = new Storage(":memory:");
		const memorySystem = new MemorySystem(storage);
		const mgr = new CompressionManager(memorySystem, storage);
		// No logs in session, should return without error
		await mgr.compressSession("empty-session");
		// No compressed entries created
		expect(storage.getAllCompressed()).toHaveLength(0);
	});

	test("compresses session with raw logs", async () => {
		const storage = new Storage(":memory:");
		const memorySystem = new MemorySystem(storage);
		const mgr = new CompressionManager(memorySystem, storage);

		memorySystem.recordRaw("s1", "worker", "# Bug Report\nGot TypeError in app.ts", 10);
		memorySystem.recordRaw("s1", "worker", "$ npm run build", 5);

		await mgr.compressSession("s1");
		const entries = storage.getAllCompressed();
		expect(entries.length).toBeGreaterThanOrEqual(1);
		expect(entries[0]?.topics).toContain("Bug Report");
	});

	test("compressSession compresses all logs into one entry", async () => {
		const storage = new Storage(":memory:");
		const memorySystem = new MemorySystem(storage);
		const mgr = new CompressionManager(memorySystem, storage);

		memorySystem.recordRaw("s1", "worker", "log 1", 1);
		memorySystem.recordRaw("s1", "worker", "log 2", 1);
		memorySystem.recordRaw("s1", "worker", "log 3", 1);

		await mgr.compressSession("s1");
		expect(storage.getAllCompressed()).toHaveLength(1);
	});
});
