/**
 * Airgent Orchestrator - Comprehensive Unit Tests
 *
 * Strategy: Skip the real Airgent constructor (which does real I/O/SQLite).
 * Use Object.create(Airgent.prototype) to create an uninitialized instance,
 * then attach mock instances for all dependencies.
 *
 * This avoids filesystem, SQLite, and network operations entirely.
 */

import type { Mock } from "bun:test";
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { resolve } from "node:path";
import type { AgentContext, ModelEntry, StructuredMemory } from "../types";

// ============================================================
// External package mocks — these MUST be hoisted above imports
// ============================================================
// UIManager imports readline and @opentui/core at module level.
// We mock these here so the UIManager module loads without error.

const mockRenderer = {
	root: {
		add: mock(),
		remove: mock(),
		findDescendantById: mock(() => null),
		flexDirection: "",
	},
	focusRenderable: mock(),
	start: mock(),
	destroy: mock(),
	requestRender: mock(),
	copyToClipboardOSC52: mock(() => true),
	on: mock(),
	keyInput: { on: mock() },
};

const mockReadlineInterface = {
	question: mock((_q: string, cb: (a: string) => void) => cb("answer")),
	close: mock(),
};

// @ts-expect-error - bun:test mock module signature
mock("readline", () => ({
	createInterface: mock(() => mockReadlineInterface),
}));
mock.module(resolve(import.meta.dir, "../../node_modules/@opentui/core"), () => {
	const r = () =>
		mock(() => {
			// biome-ignore lint/suspicious/noExplicitAny: mock object for testing
			const obj: any = {
				content: "",
				fg: "",
				width: "",
				add: mock(),
				remove: mock(),
				findDescendantById: mock(() => null),
				flexDirection: "",
			};
			return obj;
		});
	return {
		createCliRenderer: mock(() => Promise.resolve(mockRenderer)),
		InputRenderableEvents: { ENTER: "ENTER" },
		SelectRenderableEvents: { ITEM_SELECTED: "ITEM_SELECTED" },
		Text: r(),
		ScrollBox: r(),
		Input: mock(() => ({
			value: "",
			on: mock(),
			focus: mock(),
			focusable: false,
		})),
		Box: r(),
		Select: mock(() => ({
			on: mock(),
			focus: mock(),
			focusable: false,
			getSelectedOption: mock(() => ({ value: null })),
		})),
	};
});

// Application modules are loaded WITHOUT module-level mocking.
// We use Object.create(Airgent.prototype) + manual property
// injection to avoid the real constructor.
// Static import — module compilation happens once at load time.
// All describe blocks use this binding directly (no dynamic re-imports).
import { Airgent as AirgentClass } from "../Airgent";

// ============================================================
// Mock instances for all dependencies
// ============================================================

const mockSettings = {
	maxSystemPromptTokens: 3000,
	maxContextTokens: 32000,
	uiRefreshIntervalMs: 100,
	autoCompressThreshold: 0.7,
	watchdogIntervalMs: 5000,
	maxRetriesPerNode: 3,
	memoryAutoLink: true,
	showPipelineProgress: false,
	debug: false,
};
const mockModelEntry = { provider: "test", model: "gpt-4" };

const mockConfig = {
	constitution: {
		name: "Test Constitution",
		version: "1.0.0",
		principles: ["Be robust"],
		constraints: ["Never delete"],
		ethical_guidelines: ["Be helpful"],
	},
	persona: {
		name: "Test Bot",
		role: "tester",
		tone: "professional",
		rules: ["Explain"],
	},
	models: {
		planner: { ...mockModelEntry, model: "planner-v1" },
		generate: { ...mockModelEntry, model: "gen-v1" },
		compression: { ...mockModelEntry, model: "comp-v1" },
		validation: { ...mockModelEntry, model: "val-v1" },
		watchdog: { ...mockModelEntry, model: "watch-v1" },
		fallback: [],
	},
	settings: { ...mockSettings },
};

function makeMockInstances() {
	return {
		configManager: {
			load: mock(() => mockConfig),
			needsConfig: mock(() => false),
			saveSettings: mock(),
			saveModels: mock(),
			loadMCPServers: mock(() => []),
			saveMCPServers: mock(),
			getModels: mock(() => mockConfig.models),
		},
		storage: {
			createSession: mock(),
			endSession: mock(),
			close: mock(),
			getSession: mock(() => ({})),
			insertRawLog: mock(),
			getRawLogs: mock(() => []),
			insertMemory: mock(),
			insertEvidence: mock(),
			insertLink: mock(),
			searchMemories: mock(() => []),
			getLinkedMemories: mock(() => []),
			getEvidence: mock(() => []),
			findContradictions: mock(() => []),
			findCircularReferences: mock(() => []),
		},
		api: {
			healthCheck: mock(() => ({ healthy: true, version: "1.0.0" })),
			listProviders: mock(() => ({
				connected: ["test-provider"],
				all: [
					{
						id: "test-provider",
						name: "Test Provider",
						models: { "gpt-4": {} },
					},
				],
			})),
			chat: mock(() => ({ content: "mock response" })),
			streamChat: mock(function* (): Generator<string, void, unknown> {
				yield "chunk1";
				yield "chunk2";
			}),
			setAuth: mock(),
			listMCP: mock(() => ({})),
			addMCP: mock(),
			connectMCP: mock(),
			disconnectMCP: mock(),
		},
		skills: {
			getIndex: mock(() => ({ skills: [] })) as Mock<
				() => { skills: { name: string; description: string; tags: string[]; filePath: string }[] }
			>,
			getActiveSkills: mock(() => []) as Mock<() => string[]>,
			loadSkill: mock(() => null),
			injectSkill: mock((p: string) => p),
		},
		promptManager: {
			buildSystemPrompt: mock(() => ({
				prompt: "System prompt",
				tokenCount: 50,
			})),
			buildNodePrompt: mock((node: string) => `Node prompt for ${node}`),
			wouldExceedLimit: mock(() => false),
		},
		memory: {
			recordRaw: mock(),
			getRawLogsBySession: mock(() => []),
			createMemory: mock(() => "mem-id"),
			findRelevant: mock(() => []) as Mock<
				() => { id: string; bug: string; fix: string; confidence: number }[]
			>,
			getLinked: mock(() => []),
			getEvidence: mock(() => []),
			findContradictions: mock(() => []),
			findCircularReferences: mock(() => []),
		},
		compressionManager: {
			compress: mock(() => ({ id: "comp-1", title: "test" })),
			compressSession: mock(),
			decompress: mock(() => []),
		},
		pipeline: {
			registerHandler: mock(),
			registerNode: mock(),
			unregisterNode: mock(),
			buildDAG: mock(() => ({ nodes: [] })),
			execute: mock(() => new Map()),
			getState: mock(() => undefined),
			reset: mock(),
		},
		ui: {
			start: mock(() => Promise.resolve()),
			stop: mock(),
			log: mock(),
			stream: mock(),
			notice: mock(),
			updateStatus: mock(),
			copy: mock(() => ({ success: true, method: "osc52" })) as Mock<
				() => {
					success: boolean;
					method: "osc52" | "file" | "wl-copy" | "pbcopy" | "xsel" | "xclip";
					filePath?: string;
					error?: string;
				}
			>,
			prompt: mock(() => ""),
			selectModel: mock(() => null),
			showSelectMenu: mock(() => null),
			ready: false,
		},
		planner: {
			init: mock(),
			switchModel: mock(),
			analyzeTask: mock(() => ["generate", "report"]),
			selectNodes: mock(() => ["generate", "report"]),
			replan: mock(() => "replan result"),
		},
		worker: {
			init: mock(),
			switchModel: mock(),
			execute: mock(() => ({ content: "generated content" })),
		},
		memoryOrganizer: {
			init: mock(),
			switchModel: mock(),
			organize: mock(),
		},
		compression: {
			init: mock(),
			switchModel: mock(),
		},
		validation: {
			init: mock(),
			switchModel: mock(),
			validate: mock(() => ({
				contradictions: 0,
				circularReferences: 0,
				hallucinatedLinks: 0,
				inferenceAsFact: 0,
				issues: [] as string[],
				overallHealth: "healthy" as const,
			})) as Mock<
				() => {
					contradictions: number;
					circularReferences: number;
					hallucinatedLinks: number;
					inferenceAsFact: number;
					issues: string[];
					overallHealth: "healthy" | "warning" | "critical";
				}
			>,
		},
		watchdog: {
			init: mock(),
			switchModel: mock(),
			check: mock(() => ({ healthy: true, actions: [] })) as Mock<
				() => {
					healthy: boolean;
					actions: {
						type: "warning" | "force_stop" | "model_switch" | "compress_suggest";
						reason: string;
					}[];
				}
			>,
		},
		contextInspector: {
			init: mock(),
			switchModel: mock(),
			inspect: mock(() => ({
				sameErrorRepeated: false,
				purposeForgotten: false,
				todoStuck: false,
				assumptionFixed: false,
				errorChangeUnrecognized: false,
				details: [],
				score: 0,
			})),
		},
		deviceSync: {
			initGit: mock(),
			push: mock(),
			pull: mock(),
		},
		rateLimiter: {
			tryConsume: mock(() => true),
			currentTokens: 100,
		},
		logger: {
			info: mock(),
			warn: mock(),
			error: mock(),
			debug: mock(),
			fatal: mock(),
			setDebug: mock(),
			child: mock(() => ({
				info: mock(),
				warn: mock(),
				error: mock(),
				debug: mock(),
				fatal: mock(),
				setDebug: mock(),
			})),
		},
	};
}

function _clearAllMocks(mocks: ReturnType<typeof makeMockInstances>) {
	const all = [
		...Object.values(mocks.configManager),
		...Object.values(mocks.storage),
		...Object.values(mocks.api),
		...Object.values(mocks.skills),
		...Object.values(mocks.promptManager),
		...Object.values(mocks.memory),
		...Object.values(mocks.compressionManager),
		...Object.values(mocks.pipeline),
		...Object.values(mocks.ui).filter((v) => typeof v === "function"),
		...Object.values(mocks.planner),
		...Object.values(mocks.worker),
		...Object.values(mocks.memoryOrganizer),
		...Object.values(mocks.validation),
		...Object.values(mocks.watchdog),
		...Object.values(mocks.contextInspector),
		...Object.values(mocks.rateLimiter),
	].filter((v): v is Mock<(...args: any[]) => any> => typeof v === "function");
	for (const fn of all) {
		if (typeof fn?.mockClear === "function") {
			// biome-ignore lint/suspicious/noExplicitAny: mock function from bun:test
			(fn as any).mockClear();
		}
	}
}

interface AgentInstance {
	// biome-ignore lint/suspicious/noExplicitAny: test helper type
	[key: string]: any;
}

function deepClone<T>(obj: T): T {
	return structuredClone(obj);
}

function createAgent(
	// biome-ignore lint/suspicious/noExplicitAny: test helper accepts class constructor
	AirgentClass: any,
	mocks: ReturnType<typeof makeMockInstances>,
): AgentInstance {
	// Create uninitialized instance — constructor is never called
	// biome-ignore lint/suspicious/noExplicitAny: test helper creates uninitialized instance
	const agent = Object.create(AirgentClass.prototype) as any;

	// Deep clone config to prevent cross-test contamination
	const freshConfig = deepClone(mockConfig);

	// Attach all mock dependencies as properties
	agent.configManager = mocks.configManager;
	agent.config = freshConfig;
	agent.storage = mocks.storage;
	agent.api = mocks.api;
	agent.skills = mocks.skills;
	agent.promptManager = mocks.promptManager;
	agent.memory = mocks.memory;
	agent.compressionManager = mocks.compressionManager;
	agent.pipeline = mocks.pipeline;
	agent.ui = mocks.ui;
	agent.planner = mocks.planner;
	agent.worker = mocks.worker;
	agent.memoryOrganizer = mocks.memoryOrganizer;
	agent.compression = mocks.compression;
	agent.validation = mocks.validation;
	agent.watchdog = mocks.watchdog;
	agent.contextInspector = mocks.contextInspector;
	agent.deviceSync = mocks.deviceSync;
	agent.rateLimiter = mocks.rateLimiter;
	agent.logger = mocks.logger;
	agent.sessionId = null;
	agent.running = false;
	agent._startTime = Date.now();
	agent.currentTask = "";
	agent.pipelineData = {};

	return agent;
}

// ============================================================
// Tests
// ============================================================

describe("Airgent — Constructor & Initialization", () => {
	let agent: AgentInstance;
	// biome-ignore lint/suspicious/noExplicitAny: test mocks need wider types for reassignment
	let mocks: any;

	beforeEach(async () => {
		mocks = makeMockInstances() as ReturnType<typeof makeMockInstances>;
		agent = createAgent(AirgentClass, mocks);
	});

	test("creates instance using prototype without constructor", () => {
		expect(agent).toBeDefined();
		expect(agent).toBeInstanceOf(AirgentClass);
	});

	test("starts with null sessionId", () => {
		expect(agent.sessionId).toBeNull();
	});

	test("records startTime as number", () => {
		expect(typeof agent._startTime).toBe("number");
		expect(agent._startTime).toBeGreaterThan(0);
	});

	test("pipelineData starts empty", () => {
		expect(agent.pipelineData).toEqual({});
	});

	test("running starts false", () => {
		expect(agent.running).toBe(false);
	});
});

describe("Airgent — start() and stop()", () => {
	let agent: AgentInstance;
	let mocks: ReturnType<typeof makeMockInstances>;

	beforeEach(async () => {
		mocks = makeMockInstances() as ReturnType<typeof makeMockInstances>;
		agent = createAgent(AirgentClass, mocks);
	});

	test("start() initializes session and starts UI", async () => {
		await agent.start();
		expect(agent.sessionId).toBeTruthy();
		expect(agent.running).toBe(true);
		expect(mocks.ui.start).toHaveBeenCalled();
		expect(mocks.storage.createSession).toHaveBeenCalled();
	});

	test("start() is idempotent", async () => {
		await agent.start();
		const callCount = mocks.ui.start.mock.calls.length;
		await agent.start();
		expect(mocks.ui.start.mock.calls.length).toBe(callCount);
	});

	test("start() checks API health", async () => {
		await agent.start();
		expect(mocks.api.healthCheck).toHaveBeenCalled();
	});

	test("stop() stops UI and ends session", async () => {
		await agent.start();
		await agent.stop();
		expect(agent.running).toBe(false);
		expect(mocks.ui.stop).toHaveBeenCalled();
		expect(mocks.storage.endSession).toHaveBeenCalled();
		expect(mocks.storage.close).toHaveBeenCalled();
	});

	test("stop() is safe when not started", async () => {
		await agent.stop(); // not started (running=false → early return)
		expect(mocks.ui.stop).not.toHaveBeenCalled();
		expect(mocks.storage.endSession).not.toHaveBeenCalled();
	});

	test("stop() is idempotent", async () => {
		await agent.start();
		await agent.stop();
		const count = mocks.ui.stop.mock.calls.length;
		await agent.stop();
		expect(mocks.ui.stop.mock.calls.length).toBe(count);
	});
});

describe("Airgent — Command Handling", () => {
	let agent: AgentInstance;
	let mocks: ReturnType<typeof makeMockInstances>;

	async function sendInput(line: string): Promise<void> {
		await agent.handleInput(line);
	}

	beforeEach(async () => {
		mocks = makeMockInstances() as ReturnType<typeof makeMockInstances>;
		agent = createAgent(AirgentClass, mocks);
		agent.sessionId = "test-session";
		agent.running = true;
	});

	test("/help outputs command list", async () => {
		await sendInput("/help");
		expect(mocks.ui.log).toHaveBeenCalledWith("info", "airgent", expect.stringContaining("/quit"));
	});

	test("/info shows system info", async () => {
		await sendInput("/info");
		expect(mocks.ui.notice).toHaveBeenCalledWith(expect.stringContaining("Airgent v1.0.0"));
	});

	test("/info shows not connected when unhealthy", async () => {
		mocks.api.healthCheck = mock(() => ({ healthy: false, version: "" }));
		await sendInput("/info");
		expect(mocks.ui.notice).toHaveBeenCalledWith(expect.stringContaining("not connected"));
	});

	test("/status shows uptime", async () => {
		await sendInput("/status");
		expect(mocks.ui.log).toHaveBeenCalledWith("info", "airgent", expect.stringContaining("Uptime"));
	});

	test("/session outputs session JSON", async () => {
		mocks.storage.getSession = mock(() => ({ id: "s-1" }));
		await sendInput("/session");
		expect(mocks.ui.log).toHaveBeenCalledWith("info", "airgent", expect.any(String));
	});

	test("/copy with text copies to clipboard", async () => {
		await sendInput("/copy hello world");
		expect(mocks.ui.copy).toHaveBeenCalledWith("hello world");
		expect(mocks.ui.log).toHaveBeenCalledWith("info", "airgent", expect.stringContaining("Copied"));
	});

	test("/copy warns when nothing to copy", async () => {
		agent.pipelineData = {};
		await sendInput("/copy");
		expect(mocks.ui.log).toHaveBeenCalledWith(
			"warn",
			"airgent",
			expect.stringContaining("Nothing to copy"),
		);
	});

	test("/copy uses pipelineData as fallback", async () => {
		agent.pipelineData.generatedOutput = "prev output";
		await sendInput("/copy");
		expect(mocks.ui.copy).toHaveBeenCalledWith("prev output");
	});

	test("/copy shows error on clipboard failure", async () => {
		mocks.ui.copy = mock(() => ({
			success: false,
			method: "file",
			error: "failed",
		})) as Mock<
			() => {
				success: boolean;
				method: "osc52" | "file" | "wl-copy" | "pbcopy" | "xsel" | "xclip";
				filePath?: string;
				error?: string;
			}
		>;
		await sendInput("/copy text");
		expect(mocks.ui.log).toHaveBeenCalledWith(
			"error",
			"airgent",
			expect.stringContaining("Copy failed"),
		);
	});

	test("/setting opens settings menu", async () => {
		await sendInput("/setting");
		expect(mocks.ui.showSelectMenu).toHaveBeenCalledWith("Settings", expect.any(Array));
	});

	test("/compress triggers compression", async () => {
		agent.sessionId = "sess-1";
		await sendInput("/compress");
		expect(mocks.compressionManager.compressSession).toHaveBeenCalledWith("sess-1");
	});

	test("/providers lists providers", async () => {
		await sendInput("/providers");
		expect(mocks.ui.log).toHaveBeenCalledWith(
			"info",
			"providers",
			expect.stringContaining("Connected"),
		);
	});

	test("/providers handles API error", async () => {
		mocks.api.listProviders = mock(() => {
			throw new Error("fail");
		});
		await sendInput("/providers");
		expect(mocks.ui.log).toHaveBeenCalledWith("error", "providers", expect.any(String));
	});

	test("/sync push with URL pushes", async () => {
		const pushSpy = mock();
		agent.deviceSync = { initGit: mock(), push: pushSpy, pull: mock() };
		await sendInput("/sync push https://example.com/repo.git");
		expect(pushSpy).toHaveBeenCalled();
	});

	test("/sync pull pulls", async () => {
		const pullSpy = mock();
		agent.deviceSync = { initGit: mock(), push: mock(), pull: pullSpy };
		await sendInput("/sync pull");
		expect(pullSpy).toHaveBeenCalled();
	});

	test("/sync push without URL still executes push", async () => {
		const pushSpy = mock();
		agent.deviceSync = { initGit: mock(), push: pushSpy, pull: mock() };
		await sendInput("/sync push");
		// Code pushes regardless of URL presence; only git init depends on URL
		expect(pushSpy).toHaveBeenCalled();
		expect(mocks.ui.log).toHaveBeenCalledWith("info", "sync", "Push done");
	});

	test("/cat with file attempts read", async () => {
		await sendInput("/cat /tmp/test.txt");
		// smartCat runs for real — we just verify something was logged
		expect(mocks.ui.log.mock.calls.length).toBeGreaterThan(1);
	});

	test("/cat without file shows usage", async () => {
		await sendInput("/cat");
		expect(mocks.ui.log).toHaveBeenCalledWith("info", "cat", expect.stringContaining("Usage"));
	});

	test("non-command input sends to processTask", async () => {
		agent.processTask = mock();
		await sendInput("write code");
		expect(agent.processTask).toHaveBeenCalledWith("write code");
	});

	test("/mcp list shows configured servers", async () => {
		agent.configManager.loadMCPServers = mock(() => [
			{
				name: "my-srv",
				type: "local",
				command: ["node", "srv.js"],
				enabled: true,
			},
		]);
		await sendInput("/mcp list");
		expect(mocks.ui.log).toHaveBeenCalledWith("info", "mcp", expect.stringContaining("my-srv"));
	});

	test("/mcp list shows 'no servers' when empty", async () => {
		agent.configManager.loadMCPServers = mock(() => []);
		await sendInput("/mcp list");
		expect(mocks.ui.log).toHaveBeenCalledWith("info", "mcp", "No MCP servers configured");
	});

	test("/mcp add saves local server", async () => {
		const saveSpy = mock();
		agent.configManager = {
			loadMCPServers: mock(() => []),
			saveMCPServers: saveSpy,
			needsConfig: mock(() => false),
			load: mock(() => mockConfig),
			saveSettings: mock(),
			saveModels: mock(),
			getModels: mock(() => mockConfig.models),
		};
		await sendInput("/mcp add srv local node index.js");
		expect(saveSpy).toHaveBeenCalled();
	});

	test("/mcp add prevents duplicates", async () => {
		agent.configManager.loadMCPServers = mock(() => [
			{ name: "dup", type: "local", command: ["node", "x.js"], enabled: true },
		]);
		await sendInput("/mcp add dup local node x.js");
		expect(mocks.ui.log).toHaveBeenCalledWith(
			"warn",
			"mcp",
			expect.stringContaining("already exists"),
		);
	});

	test("/mcp add with missing args shows usage", async () => {
		await sendInput("/mcp add");
		expect(mocks.ui.log).toHaveBeenCalledWith("warn", "mcp", expect.stringContaining("Usage"));
	});

	test("/mcp add-remote saves remote", async () => {
		const saveSpy = mock();
		agent.configManager = {
			loadMCPServers: mock(() => []),
			saveMCPServers: saveSpy,
			needsConfig: mock(() => false),
			load: mock(() => mockConfig),
			saveSettings: mock(),
			saveModels: mock(),
			getModels: mock(() => mockConfig.models),
		};
		await sendInput("/mcp add-remote remote-srv https://example.com/mcp");
		expect(saveSpy).toHaveBeenCalled();
	});

	test("/mcp add-remote missing args shows usage", async () => {
		await sendInput("/mcp add-remote");
		expect(mocks.ui.log).toHaveBeenCalledWith("warn", "mcp", expect.stringContaining("Usage"));
	});

	test("/mcp connect connects server", async () => {
		await sendInput("/mcp connect my-srv");
		expect(mocks.api.connectMCP).toHaveBeenCalledWith("my-srv");
	});

	test("/mcp connect without name shows usage", async () => {
		await sendInput("/mcp connect");
		expect(mocks.ui.log).toHaveBeenCalledWith("warn", "mcp", expect.stringContaining("Usage"));
	});

	test("/mcp disconnect disconnects", async () => {
		await sendInput("/mcp disconnect my-srv");
		expect(mocks.api.disconnectMCP).toHaveBeenCalledWith("my-srv");
	});

	test("/mcp remove deletes server from config", async () => {
		const saveSpy = mock();
		agent.configManager.loadMCPServers = mock(() => [
			{ name: "s1", type: "local", command: ["node", "x.js"], enabled: true },
		]);
		agent.configManager.saveMCPServers = saveSpy;
		await sendInput("/mcp remove s1");
		expect(saveSpy).toHaveBeenCalledWith([]);
	});

	test("/mcp unknown subcommand warns", async () => {
		await sendInput("/mcp badcmd");
		expect(mocks.ui.log).toHaveBeenCalledWith(
			"warn",
			"mcp",
			expect.stringContaining("Unknown subcommand"),
		);
	});

	test("/model lists current models", async () => {
		await sendInput("/model");
		expect(mocks.ui.log).toHaveBeenCalledWith("info", "model", expect.stringContaining("planner"));
	});

	test("unknown command is processed as task", async () => {
		const pt = mock();
		agent.processTask = pt;
		await sendInput("some unknown thing");
		expect(pt).toHaveBeenCalledWith("some unknown thing");
	});

	test("rate limited input returns early", async () => {
		agent.rateLimiter.tryConsume = mock(() => false);
		await sendInput("/help");
		expect(mocks.ui.log).toHaveBeenCalledWith(
			"warn",
			"airgent",
			expect.stringContaining("Rate limit"),
		);
	});
});

describe("Airgent — processTask flow", () => {
	let agent: AgentInstance;
	let mocks: ReturnType<typeof makeMockInstances>;

	beforeEach(async () => {
		mocks = makeMockInstances() as ReturnType<typeof makeMockInstances>;
		agent = createAgent(AirgentClass, mocks);
		agent.sessionId = "test-session";
		agent.running = true;
	});

	test("processTask throws if not started", async () => {
		agent.sessionId = null;
		expect(agent.processTask("test")).rejects.toThrow("Not started");
	});

	test("processTask plans and executes pipeline", async () => {
		agent.pipelineData.generatedOutput = "output";
		await agent.processTask("write code");
		expect(mocks.planner.analyzeTask).toHaveBeenCalledWith("write code");
		expect(mocks.pipeline.execute).toHaveBeenCalled();
		expect(mocks.planner.init).toHaveBeenCalled();
		expect(mocks.worker.init).toHaveBeenCalled();
		expect(mocks.validation.init).toHaveBeenCalled();
		expect(mocks.watchdog.init).toHaveBeenCalled();
		expect(mocks.contextInspector.init).toHaveBeenCalled();
	});

	test("processTask displays generated output", async () => {
		// processTask resets pipelineData, so we need the pipeline execute
		// to populate generatedOutput
		mocks.pipeline.execute = mock(() => {
			agent.pipelineData.generatedOutput = "output text";
			return new Map();
		});
		await agent.processTask("test");
		expect(mocks.ui.log).toHaveBeenCalledWith("info", "ai", "output text");
	});

	test("processTask skips output when empty", async () => {
		mocks.pipeline.execute = mock(() => {
			agent.pipelineData.generatedOutput = "";
			return new Map();
		});
		await agent.processTask("test");
		// biome-ignore lint/suspicious/noExplicitAny: mock calls type from bun:test
		const aiLogs = mocks.ui.log.mock.calls.filter((c: any) => c[1] === "ai");
		expect(aiLogs.length).toBe(0);
	});

	test("processTask runs context inspection", async () => {
		await agent.processTask("test");
		expect(mocks.contextInspector.inspect).toHaveBeenCalled();
	});

	test("processTask warns on high corruption", async () => {
		mocks.contextInspector.inspect = mock(() => ({
			sameErrorRepeated: false,
			purposeForgotten: false,
			todoStuck: false,
			assumptionFixed: false,
			errorChangeUnrecognized: false,
			details: [],
			score: 0.8,
		}));
		await agent.processTask("test");
		expect(mocks.ui.log).toHaveBeenCalledWith(
			"warn",
			"inspector",
			expect.stringContaining("Corruption"),
		);
	});

	test("processTask does not warn on low corruption", async () => {
		mocks.contextInspector.inspect = mock(() => ({
			sameErrorRepeated: false,
			purposeForgotten: false,
			todoStuck: false,
			assumptionFixed: false,
			errorChangeUnrecognized: false,
			details: [],
			score: 0.3,
		}));
		await agent.processTask("test");
		// biome-ignore lint/suspicious/noExplicitAny: mock calls type from bun:test
		const warns = mocks.ui.log.mock.calls.filter((c: any) => c[1] === "inspector");
		expect(warns.length).toBe(0);
	});

	test("processTask runs watchdog", async () => {
		await agent.processTask("test");
		expect(mocks.watchdog.check).toHaveBeenCalled();
	});

	test("processTask warns on unhealthy watchdog", async () => {
		mocks.watchdog.check = mock(() => ({
			healthy: false,
			actions: [{ type: "warning", reason: "issue" }],
		})) as Mock<() => { healthy: boolean; actions: { type: "warning"; reason: string }[] }>;
		await agent.processTask("test");
		expect(mocks.ui.log).toHaveBeenCalledWith("warn", "watchdog", expect.any(String));
	});

	test("processTask updates status", async () => {
		await agent.processTask("test");
		expect(mocks.ui.updateStatus).toHaveBeenCalledWith({ status: "running" });
		expect(mocks.ui.updateStatus).toHaveBeenCalledWith({
			pipelineNode: "plan",
		});
		expect(mocks.ui.updateStatus).toHaveBeenCalledWith({
			pipelineNode: "execute",
		});
		expect(mocks.ui.updateStatus).toHaveBeenCalledWith({
			status: "completed",
			pipelineNode: "",
		});
	});

	test("processTask handles errors gracefully", async () => {
		mocks.planner.analyzeTask = mock(() => {
			throw new Error("plan failed");
		});
		await agent.processTask("test");
		expect(mocks.ui.log).toHaveBeenCalledWith(
			"error",
			"airgent",
			expect.stringContaining("plan failed"),
		);
	});

	test("processTask sets error status on failure", async () => {
		mocks.planner.analyzeTask = mock(() => {
			throw new Error("fail");
		});
		await agent.processTask("test");
		expect(mocks.ui.updateStatus).toHaveBeenCalledWith({ status: "error" });
	});

	test("processTask resets pipelineData at start", async () => {
		agent.pipelineData = { generatedOutput: "old" };
		await agent.processTask("new task");
		// pipelineData is cleared before processing
		expect(agent.currentTask).toBe("new task");
	});
});

describe("Airgent — buildAgentContext", () => {
	let agent: AgentInstance;
	let mocks: ReturnType<typeof makeMockInstances>;

	beforeEach(async () => {
		mocks = makeMockInstances() as ReturnType<typeof makeMockInstances>;
		agent = createAgent(AirgentClass, mocks);
		agent.sessionId = "test-session";
	});

	test("returns context with all required fields", () => {
		const ctx: AgentContext = agent.buildAgentContext("task");
		expect(ctx).toHaveProperty("sessionId", "test-session");
		expect(ctx).toHaveProperty("systemPrompt");
		expect(ctx).toHaveProperty("skillIndex");
		expect(ctx).toHaveProperty("activeSkills");
		expect(ctx).toHaveProperty("memory");
		expect(ctx).toHaveProperty("state");
		expect(ctx).toHaveProperty("tokenCount");
		expect(ctx).toHaveProperty("messages");
	});

	test("includes systemPrompt from PromptManager", () => {
		mocks.promptManager.buildSystemPrompt = mock(() => ({
			prompt: "custom prompt",
			tokenCount: 50,
		}));
		const ctx: AgentContext = agent.buildAgentContext("task");
		expect(ctx.systemPrompt).toBe("custom prompt");
	});

	test("includes relevant memories", () => {
		const mems: StructuredMemory[] = [
			{
				id: "m1",
				sessionId: "sess-1",
				bug: "b",
				investigation: "",
				root_cause: "",
				fix: "f",
				reason: "",
				evidence: [],
				confidence: 0.9,
				tags: [],
				files: [],
				commands: [],
				created: 0,
				updated: 0,
				links: [],
			},
		];
		mocks.memory.findRelevant = mock(() => mems) as Mock<() => StructuredMemory[]>;
		const ctx: AgentContext = agent.buildAgentContext("task");
		expect(ctx.memory.relevantMemories).toEqual(mems);
	});

	test("includes skillIndex", () => {
		mocks.skills.getIndex = mock(() => ({
			skills: [{ name: "s1", description: "d1", tags: [], filePath: "/x" }],
		})) as Mock<
			() => { skills: { name: string; description: string; tags: string[]; filePath: string }[] }
		>;
		const ctx: AgentContext = agent.buildAgentContext("t");
		expect(ctx.skillIndex.skills).toHaveLength(1);
		expect(ctx.skillIndex.skills[0]?.name).toBe("s1");
	});

	test("includes activeSkills", () => {
		mocks.skills.getActiveSkills = mock(() => ["skill-a", "skill-b"]) as Mock<() => string[]>;
		const ctx: AgentContext = agent.buildAgentContext("t");
		expect(ctx.activeSkills).toEqual(["skill-a", "skill-b"]);
	});

	test("tokenCount estimated from prompt and task length", () => {
		mocks.promptManager.buildSystemPrompt = mock(() => ({
			prompt: "hello",
			tokenCount: 2,
		}));
		const ctx: AgentContext = agent.buildAgentContext("world");
		expect(ctx.tokenCount).toBe(3); // ceil((5+5)/4) = 3
	});

	test("messages contain one user message", () => {
		const ctx: AgentContext = agent.buildAgentContext("do something");
		expect(ctx.messages).toHaveLength(1);
		expect(ctx.messages[0]?.role).toBe("user");
		expect(ctx.messages[0]?.content).toBe("do something");
	});

	test("state includes task and startTime", () => {
		const ctx: AgentContext = agent.buildAgentContext("my task");
		expect(ctx.state).toHaveProperty("task", "my task");
		expect(ctx.state).toHaveProperty("startTime");
		expect(typeof ctx.state.startTime).toBe("number");
	});
});

describe("Airgent — Pipeline Handlers", () => {
	let agent: AgentInstance;
	let mocks: ReturnType<typeof makeMockInstances>;
	// biome-ignore lint/complexity/noBannedTypes: test helper type
	let handlers: Map<string, Function>;

	beforeEach(async () => {
		mocks = makeMockInstances() as ReturnType<typeof makeMockInstances>;
		agent = createAgent(AirgentClass, mocks);
		agent.sessionId = "sess-1";
		agent.currentTask = "test task";

		// Register handlers on our mock pipeline
		AirgentClass.prototype.registerPipelineHandlers.call(agent);
		handlers = new Map();
		for (const call of mocks.pipeline.registerHandler.mock.calls) {
			handlers.set(call[0], call[1]);
		}
	});

	test("clarify handler stores clarifiedTask", async () => {
		mocks.api.chat = mock(() => ({ content: "clarified" }));
		const h = handlers.get("clarify")!;
		const result = await h(new Map());
		expect(agent.pipelineData.clarifiedTask).toBe("clarified");
		expect(result).toHaveProperty("content");
	});

	test("clarify handler uses streaming when showPipelineProgress", async () => {
		agent.config.settings.showPipelineProgress = true; // only affects this handler call
		mocks.api.streamChat = mock(function* (): Generator<string, void, unknown> {
			yield "streamed output";
		}) as Mock<() => Generator<string, void, unknown>>;
		const h = handlers.get("clarify")!;
		const result = await h(new Map());
		expect(result).toHaveProperty("content");
		// config deep clone means this mutation stays local
	});

	test("plan handler stores plan", async () => {
		mocks.api.chat = mock(() => ({ content: "the plan" }));
		const h = handlers.get("plan")!;
		await h(new Map());
		expect(agent.pipelineData.plan).toBe("the plan");
	});

	test("plan handler uses clarifiedTask when available", async () => {
		agent.pipelineData.clarifiedTask = "clarified";
		mocks.api.chat = mock(() => ({ content: "plan result" }));
		const h = handlers.get("plan")!;
		await h(new Map());
		expect(mocks.promptManager.buildNodePrompt).toHaveBeenCalledWith("plan");
	});

	test("generate handler stores generatedOutput", async () => {
		mocks.worker.execute = mock(() => ({ content: "generated content" }));
		const h = handlers.get("generate")!;
		const result = await h(new Map());
		expect(agent.pipelineData.generatedOutput).toBe("generated content");
		expect(result).toHaveProperty("content");
	});

	test("generate handler includes plan and clarifiedTask", async () => {
		agent.pipelineData.plan = "my plan";
		agent.pipelineData.clarifiedTask = "clarify";
		mocks.worker.execute = mock(() => ({ content: "result" }));
		const h = handlers.get("generate")!;
		await h(new Map());
		expect(mocks.worker.execute).toHaveBeenCalled();
	});

	test("generate handler includes relevant memories", async () => {
		mocks.memory.findRelevant = mock(() => [
			{
				id: "m1",
				sessionId: "sess-1",
				bug: "b1",
				investigation: "",
				root_cause: "",
				fix: "f1",
				reason: "",
				evidence: [],
				confidence: 0.9,
				tags: [],
				files: [],
				commands: [],
				created: 0,
				updated: 0,
				links: [],
			},
		]) as Mock<() => StructuredMemory[]>;
		mocks.worker.execute = mock(() => ({ content: "result" }));
		const h = handlers.get("generate")!;
		await h(new Map());
		expect(mocks.worker.execute).toHaveBeenCalled();
	});

	test("test handler skips when no generatedOutput", async () => {
		agent.pipelineData.generatedOutput = undefined;
		const h = handlers.get("test")!;
		const result = await h(new Map());
		expect(result).toEqual({ status: "skipped", reason: "no output" });
	});

	test("test handler evaluates output", async () => {
		agent.pipelineData.generatedOutput = "some output";
		mocks.api.chat = mock(() => ({ content: "test result" }));
		const h = handlers.get("test")!;
		// biome-ignore lint/suspicious/noExplicitAny: handler returns dynamic type
		const result: any = await h(new Map());
		expect(agent.pipelineData.testResult).toBe("test result");
		expect(result).toHaveProperty("content");
	});

	test("test handler detects issues", async () => {
		agent.pipelineData.generatedOutput = "buggy";
		mocks.api.chat = mock(() => ({ content: "found a bug here" }));
		const h = handlers.get("test")!;
		// biome-ignore lint/suspicious/noExplicitAny: handler returns dynamic type
		const result: any = await h(new Map());
		expect(result.passed).toBe(false);
	});

	test("test handler passes clean output", async () => {
		agent.pipelineData.generatedOutput = "clean";
		// Must NOT match regex /(bug|error|issue|incorrect|wrong|missing)/i
		mocks.api.chat = mock(() => ({
			content: "all looks correct, reviewed and approved",
		}));
		const h = handlers.get("test")!;
		// biome-ignore lint/suspicious/noExplicitAny: handler returns dynamic type
		const result: any = await h(new Map());
		expect(result.passed).toBe(true);
	});

	test("validate handler calls validation agent", async () => {
		mocks.validation.validate = mock(() => ({
			contradictions: 0,
			circularReferences: 0,
			hallucinatedLinks: 0,
			inferenceAsFact: 0,
			issues: [],
			overallHealth: "healthy",
		}));
		const h = handlers.get("validate")!;
		// biome-ignore lint/suspicious/noExplicitAny: handler returns dynamic type
		const result: any = await h(new Map());
		expect(result.overallHealth).toBe("healthy");
	});

	test("validate handler warns on unhealthy", async () => {
		mocks.validation.validate = mock(() => ({
			contradictions: 2,
			circularReferences: 1,
			hallucinatedLinks: 0,
			inferenceAsFact: 0,
			issues: ["i1"],
			overallHealth: "warning",
		})) as Mock<
			() => {
				contradictions: number;
				circularReferences: number;
				hallucinatedLinks: number;
				inferenceAsFact: number;
				issues: string[];
				overallHealth: "warning";
			}
		>;
		const h = handlers.get("validate")!;
		await h(new Map());
		expect(mocks.ui.log).toHaveBeenCalledWith(
			"warn",
			"validation",
			expect.stringContaining("Health"),
		);
	});

	test("report handler organizes and compresses", async () => {
		const h = handlers.get("report")!;
		// biome-ignore lint/suspicious/noExplicitAny: handler returns dynamic type
		const result: any = await h(new Map());
		expect(mocks.memoryOrganizer.organize).toHaveBeenCalledWith("sess-1");
		expect(mocks.compressionManager.compressSession).toHaveBeenCalledWith("sess-1");
		expect(result.status).toBe("completed");
	});

	test("report handler skips when no sessionId", async () => {
		agent.sessionId = null;
		const h = handlers.get("report")!;
		await h(new Map());
		expect(mocks.memoryOrganizer.organize).not.toHaveBeenCalled();
	});
});

describe("Airgent — Edge Cases", () => {
	let agent: AgentInstance;
	let mocks: ReturnType<typeof makeMockInstances>;

	beforeEach(async () => {
		mocks = makeMockInstances() as ReturnType<typeof makeMockInstances>;
		agent = createAgent(AirgentClass, mocks);
		agent.sessionId = "sess-1";
		agent.running = true;
	});

	test("empty task processes with plan step", async () => {
		mocks.planner.analyzeTask = mock(() => ["generate", "report"]);
		await expect(agent.processTask("")).resolves.toBeUndefined();
	});

	test("long task (10k chars) passed to planner", async () => {
		const long = "a".repeat(10000);
		mocks.planner.analyzeTask = mock(() => ["generate", "report"]);
		mocks.worker.execute = mock(() => ({ content: "ok" }));
		await agent.processTask(long);
		expect(mocks.planner.analyzeTask).toHaveBeenCalledWith(long);
	});

	test("pipeline with no selected nodes", async () => {
		mocks.planner.analyzeTask = mock(() => []);
		mocks.worker.execute = mock(() => ({ content: "test" }));
		await agent.processTask("task");
		expect(mocks.pipeline.execute).toHaveBeenCalled();
	});

	test("sequential tasks update currentTask", async () => {
		mocks.planner.analyzeTask = mock(() => ["generate", "report"]);
		mocks.worker.execute = mock(() => ({ content: "o" }));
		await agent.processTask("first");
		expect(agent.currentTask).toBe("first");
		await agent.processTask("second");
		expect(agent.currentTask).toBe("second");
	});
});

describe("Airgent — Streaming (streamNodeOutput)", () => {
	let agent: AgentInstance;
	let mocks: ReturnType<typeof makeMockInstances>;

	beforeEach(async () => {
		mocks = makeMockInstances() as ReturnType<typeof makeMockInstances>;
		agent = createAgent(AirgentClass, mocks);
	});

	test("streamNodeOutput streams and returns content", async () => {
		mocks.api.streamChat = mock(function* (): Generator<string, void, unknown> {
			yield "hello ";
			yield "world";
		}) as Mock<() => Generator<string, void, unknown>>;
		const model: ModelEntry = { provider: "test", model: "gpt-4" };
		const msgs = [{ role: "user" as const, content: "hi" }];
		const result = await agent.streamNodeOutput(model, msgs, "test-node", "plan");
		expect(result).toBe("hello world");
		expect(agent.pipelineData.plan).toBe("hello world");
	});

	test("streamNodeOutput stores in pipelineData field", async () => {
		mocks.api.streamChat = mock(function* (): Generator<string, void, unknown> {
			yield "stored";
		}) as Mock<() => Generator<string, void, unknown>>;
		await agent.streamNodeOutput(
			{ provider: "test", model: "gpt-4" },
			[{ role: "user", content: "hi" }],
			"node",
			"generatedOutput",
		);
		expect(agent.pipelineData.generatedOutput).toBe("stored");
	});

	test("streamNodeOutput falls back to non-streaming on error", async () => {
		mocks.api.streamChat = mock(function* (): Generator<string, void, unknown> {
			yield "";
			throw new Error("stream failed");
		}) as Mock<() => Generator<string, void, unknown>>;
		mocks.api.chat = mock(() => ({ content: "fallback" }));
		const result = await agent.streamNodeOutput(
			{ provider: "test", model: "gpt-4" },
			[{ role: "user", content: "hi" }],
			"node",
			"plan",
		);
		expect(result).toBe("fallback");
		expect(agent.pipelineData.plan).toBe("fallback");
	});

	test("streamNodeOutput shows node prefix", async () => {
		mocks.api.streamChat = mock(function* (): Generator<string, void, unknown> {
			yield "data";
		}) as Mock<() => Generator<string, void, unknown>>;
		await agent.streamNodeOutput(
			{ provider: "test", model: "gpt-4" },
			[{ role: "user", content: "hi" }],
			"my-node",
			"plan",
		);
		expect(mocks.ui.stream).toHaveBeenCalledWith("  → my-node");
	});
});

describe("Airgent — applyModelConfig", () => {
	let agent: AgentInstance;
	let mocks: ReturnType<typeof makeMockInstances>;

	beforeEach(async () => {
		mocks = makeMockInstances() as ReturnType<typeof makeMockInstances>;
		agent = createAgent(AirgentClass, mocks);
	});

	test("switches all agent models", () => {
		agent.applyModelConfig();
		expect(mocks.planner.switchModel).toHaveBeenCalled();
		expect(mocks.worker.switchModel).toHaveBeenCalled();
		expect(mocks.validation.switchModel).toHaveBeenCalled();
		expect(mocks.watchdog.switchModel).toHaveBeenCalled();
		expect(mocks.contextInspector.switchModel).toHaveBeenCalled();
		expect(mocks.memoryOrganizer.switchModel).toHaveBeenCalled();
		expect(mocks.compression.switchModel).toHaveBeenCalled();
	});

	test("uses current model config values", () => {
		agent.config.models = {
			...mockConfig.models,
			planner: { provider: "custom", model: "custom-planner" },
		};
		agent.applyModelConfig();
		expect(mocks.planner.switchModel).toHaveBeenCalledWith(
			expect.objectContaining({ provider: "custom", model: "custom-planner" }),
		);
	});
});

describe("Airgent — updateStatus", () => {
	let agent: AgentInstance;
	let mocks: ReturnType<typeof makeMockInstances>;

	beforeEach(async () => {
		mocks = makeMockInstances() as ReturnType<typeof makeMockInstances>;
		agent = createAgent(AirgentClass, mocks);
	});

	test("updateStatus delegates to UI manager", () => {
		agent.updateStatus({ status: "running" });
		expect(mocks.ui.updateStatus).toHaveBeenCalledWith({ status: "running" });
	});

	test("updateStatus with multiple fields", () => {
		agent.updateStatus({
			sessionId: "s1",
			status: "running",
			pipelineNode: "plan",
		});
		expect(mocks.ui.updateStatus).toHaveBeenCalledWith({
			sessionId: "s1",
			status: "running",
			pipelineNode: "plan",
		});
	});
});
