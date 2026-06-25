/**
 * Tests for sync/index.ts (DeviceSync)
 *
 * Uses real fs with temp directory, real Storage with :memory: SQLite,
 * and direct assignment for Bun.spawnSync mock (with save/restore).
 * Does NOT use mock.module (avoids process-global leakage).
 */

import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	mock,
	test,
} from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { Storage as StorageType } from "../../storage";
import type { DeviceSync as DeviceSyncType } from "../index";

// ---------------------------------------------------------------------------
// Temp directory setup
// ---------------------------------------------------------------------------
const TEMP_BASE = fs.mkdtempSync(path.join(os.tmpdir(), "airgent-sync-test-"));
const SYNC_DIR = path.join(TEMP_BASE, ".config", "Airgent", "sync");

let DeviceSync: typeof DeviceSyncType;
let realStorage: StorageType;

// Save original Bun.spawnSync for restoration in afterAll
const ORIGINAL_SPAWN_SYNC = Bun.spawnSync;

// Helper: create a spawn mock that returns success by default
function createSpawnMock(
	overrides?: Partial<ReturnType<typeof Bun.spawnSync>>,
) {
	return mock((..._args: any[]) => ({
		exitCode: 0,
		stdout: Buffer.from(""),
		stderr: Buffer.from(""),
		...overrides,
	}));
}

beforeAll(async () => {
	// Create the sync directory
	fs.mkdirSync(SYNC_DIR, { recursive: true });

	// Import Storage with :memory: database
	const { Storage } = await import("../../storage");
	realStorage = new Storage(":memory:");

	// Import DeviceSync — we pass syncDir to constructor, so no os.homedir mock needed
	const mod = await import("../index");
	DeviceSync = mod.DeviceSync;
});

afterAll(() => {
	// Restore original Bun.spawnSync
	(Bun as any).spawnSync = ORIGINAL_SPAWN_SYNC;

	// Close the in-memory database
	if (realStorage && typeof realStorage.close === "function") {
		realStorage.close();
	}
	// Remove temp directory tree
	fs.rmSync(TEMP_BASE, { recursive: true, force: true });
});

beforeEach(() => {
	// Replace Bun.spawnSync with a fresh mock for each test
	(Bun as any).spawnSync = createSpawnMock();

	// Wipe the sync directory clean (but keep the dir itself)
	if (fs.existsSync(SYNC_DIR)) {
		for (const entry of fs.readdirSync(SYNC_DIR)) {
			fs.rmSync(path.join(SYNC_DIR, entry), { recursive: true, force: true });
		}
	}

	// Wipe all Storage tables
	const tables = [
		"compressed_entries",
		"metadata",
		"sessions",
		"session_messages",
		"memories",
		"memory_links",
		"evidence",
		"raw_logs",
	];
	for (const table of tables) {
		try {
			(realStorage as any).db.prepare(`DELETE FROM ${table}`).run();
		} catch {
			// Table may not exist yet on first run; ignore.
		}
	}
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("DeviceSync", () => {
	test("constructor creates sync directory", () => {
		// Remove the directory so the constructor must create it
		fs.rmSync(SYNC_DIR, { recursive: true, force: true });
		expect(fs.existsSync(SYNC_DIR)).toBe(false);

		new DeviceSync(realStorage, SYNC_DIR);

		expect(fs.existsSync(SYNC_DIR)).toBe(true);
	});

	test("initGit initializes git repository", () => {
		const sync = new DeviceSync(realStorage, SYNC_DIR);
		sync.initGit("https://github.com/user/repo.git");

		const spy = Bun.spawnSync as any;
		const initCalls = spy.mock.calls.filter(
			(call: any[]) => call[0]?.[0] === "git" && call[0]?.[1] === "init",
		);
		expect(initCalls.length).toBe(1);

		const remoteAddCalls = spy.mock.calls.filter(
			(call: any[]) => call[0]?.[1] === "remote" && call[0]?.[2] === "add",
		);
		expect(remoteAddCalls.length).toBe(1);
	});

	test("initGit creates .gitignore", () => {
		const sync = new DeviceSync(realStorage, SYNC_DIR);
		sync.initGit("https://github.com/user/repo.git");

		expect(fs.existsSync(path.join(SYNC_DIR, ".gitignore"))).toBe(true);
	});

	test("push exports data and runs git commands", () => {
		// Seed storage
		realStorage.saveCompressedEntry({
			id: "c1",
			originalId: "o1",
			title: "Test",
			topics: [],
			timestamp: 1000,
			entities: [],
			files: [],
			commands: [],
			errorKeywords: [],
			importanceScore: 0.5,
			tokenCount: 100,
			compressedContent: "data",
		});
		realStorage.setMetadata("key1", "val1");

		const sync = new DeviceSync(realStorage, SYNC_DIR);
		sync.push();

		// Verify export file was written
		const exportFile = path.join(SYNC_DIR, "export.json");
		expect(fs.existsSync(exportFile)).toBe(true);

		const exported = JSON.parse(fs.readFileSync(exportFile, "utf-8"));
		expect(exported.compressed).toHaveLength(1);
		expect(exported.compressed[0].id).toBe("c1");
		expect(exported.metadata.key1).toBe("val1");
		expect(exported.sessions).toEqual([]);

		// Verify git commands were issued
		const spy = Bun.spawnSync as any;
		expect(spy.mock.calls.length).toBeGreaterThan(0);
	});

	test("push with no data exports empty arrays", () => {
		const sync = new DeviceSync(realStorage, SYNC_DIR);
		sync.push();

		const exportFile = path.join(SYNC_DIR, "export.json");
		expect(fs.existsSync(exportFile)).toBe(true);

		const exported = JSON.parse(fs.readFileSync(exportFile, "utf-8"));
		expect(exported.compressed).toEqual([]);
		expect(exported.metadata).toEqual({});
		expect(exported.sessions).toEqual([]);
	});

	test("pull imports data from export file", () => {
		const exportData = {
			compressed: [
				{
					id: "c1",
					originalId: "o1",
					title: "Test",
					topics: [],
					timestamp: 1000,
					entities: [],
					files: [],
					commands: [],
					errorKeywords: [],
					importanceScore: 0.5,
					tokenCount: 100,
					compressedContent: "data",
				},
			],
			metadata: { key1: "val1" },
			sessions: [{ id: "s1", summary: "active" }],
			exportedAt: new Date().toISOString(),
		};
		fs.writeFileSync(
			path.join(SYNC_DIR, "export.json"),
			JSON.stringify(exportData),
		);

		const sync = new DeviceSync(realStorage, SYNC_DIR);
		sync.pull();

		// Verify data landed in Storage
		const all = realStorage.getAllCompressed();
		expect(all).toHaveLength(1);
		expect(all[0].title).toBe("Test");
		expect(realStorage.getMetadata("key1")).toBe("val1");
	});

	test("pull handles missing export file gracefully", () => {
		const sync = new DeviceSync(realStorage, SYNC_DIR);
		sync.pull();

		expect(realStorage.getAllCompressed()).toEqual([]);
	});

	test("pull with empty compressed array works", () => {
		fs.writeFileSync(
			path.join(SYNC_DIR, "export.json"),
			JSON.stringify({
				compressed: [],
				metadata: {},
				sessions: [],
				exportedAt: new Date().toISOString(),
			}),
		);

		const sync = new DeviceSync(realStorage, SYNC_DIR);
		sync.pull();

		expect(realStorage.getAllCompressed()).toEqual([]);
	});

	test("git command failure throws error", () => {
		(Bun as any).spawnSync = createSpawnMock({
			exitCode: 1,
			stderr: Buffer.from("fatal: not a git repository"),
		});

		const sync = new DeviceSync(realStorage, SYNC_DIR);
		try {
			sync.push();
			// If we reach here the test should fail — force it
			expect("should have thrown").toBe("but did not");
		} catch (e: unknown) {
			expect(e).toBeDefined();
			expect((e as Error).message).toContain("git");
		}
	});

	test("initGit handles existing git repository", () => {
		// Create a .git directory to simulate existing repo
		const gitDir = path.join(SYNC_DIR, ".git");
		fs.mkdirSync(gitDir, { recursive: true });
		fs.writeFileSync(path.join(gitDir, "HEAD"), "ref: refs/heads/main\n");

		const sync = new DeviceSync(realStorage, SYNC_DIR);
		sync.initGit("https://github.com/user/repo.git");

		const spy = Bun.spawnSync as any;
		// Should NOT call git init
		const initCalls = spy.mock.calls.filter(
			(call: any[]) => call[0]?.[0] === "git" && call[0]?.[1] === "init",
		);
		expect(initCalls.length).toBe(0);

		// Should call git remote set-url
		const setUrlCalls = spy.mock.calls.filter(
			(call: any[]) => call[0]?.[1] === "remote" && call[0]?.[2] === "set-url",
		);
		expect(setUrlCalls.length).toBe(1);
	});

	test("conflicting data during pull overwrites locally", () => {
		fs.writeFileSync(
			path.join(SYNC_DIR, "export.json"),
			JSON.stringify({
				compressed: [
					{
						id: "c1",
						originalId: "o1",
						title: "Overwritten",
						topics: ["conflict"],
						timestamp: 2000,
						entities: [],
						files: [],
						commands: [],
						errorKeywords: [],
						importanceScore: 0.9,
						tokenCount: 50,
						compressedContent: "new data",
					},
				],
				metadata: { key1: "newval" },
				sessions: [],
				exportedAt: new Date().toISOString(),
			}),
		);

		const sync = new DeviceSync(realStorage, SYNC_DIR);
		sync.pull();

		const all = realStorage.getAllCompressed();
		expect(all).toHaveLength(1);
		expect(all[0].title).toBe("Overwritten");
		expect(realStorage.getMetadata("key1")).toBe("newval");
	});

	test("push with large data exports successfully", () => {
		const manyCompressed = Array.from({ length: 100 }, (_, i) => ({
			id: `c${i}`,
			originalId: `o${i}`,
			title: `Entry ${i}`,
			topics: [],
			timestamp: Date.now(),
			entities: [],
			files: [],
			commands: [],
			errorKeywords: [],
			importanceScore: Math.random(),
			tokenCount: 100 + i,
			compressedContent: "x".repeat(100),
		}));
		for (const entry of manyCompressed) {
			realStorage.saveCompressedEntry(entry);
		}

		const sync = new DeviceSync(realStorage, SYNC_DIR);
		sync.push();

		const exportFile = path.join(SYNC_DIR, "export.json");
		expect(fs.existsSync(exportFile)).toBe(true);

		const exported = JSON.parse(fs.readFileSync(exportFile, "utf-8"));
		expect(exported.compressed).toHaveLength(100);
	});

	test("git command result parsing returns stdout and stderr", () => {
		(Bun as any).spawnSync = createSpawnMock({
			stdout: Buffer.from("on branch main"),
		});

		const sync = new DeviceSync(realStorage, SYNC_DIR);
		const result = (sync as any).git(["status"]);
		expect(result.stdout).toBe("on branch main");
		expect(result.stderr).toBe("");
	});

	test("network failure during push is caught", () => {
		(Bun as any).spawnSync = mock((..._args: any[]) => {
			throw new Error("ENOTFOUND github.com");
		});

		const sync = new DeviceSync(realStorage, SYNC_DIR);
		expect(() => sync.push()).toThrow();
	});

	test("initGit with non-default remote URL", () => {
		const sync = new DeviceSync(realStorage, SYNC_DIR);
		sync.initGit("https://gitlab.com/user/repo.git");

		expect(fs.existsSync(path.join(SYNC_DIR, ".gitignore"))).toBe(true);
	});

	test("sync dir is created even without git init", () => {
		const sync = new DeviceSync(realStorage, SYNC_DIR);
		expect(sync).toBeDefined();
		expect(fs.existsSync(SYNC_DIR)).toBe(true);
	});
});
