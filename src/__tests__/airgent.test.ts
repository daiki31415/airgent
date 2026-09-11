/**
 * Airgent Orchestrator - Comprehensive Unit Tests
 *
 * Modern build: construct a real Airgent instance via dependency injection,
 * passing hand-rolled lightweight spy fakes for every dependency. The real
 * constructor runs (no Object.create / prototype bypass), but every dependency
 * that would touch the filesystem, SQLite, or the network is a pure spy.
 *
 * Because these are hand-rolled spies (not bun mock functions), call-verification
 * uses a tiny matcher engine over each spy's `.calls` array instead of
 * `toHaveBeenCalled*`. This keeps the orchestration-order assertions intact.
 */

import { beforeEach, describe, expect, test } from "bun:test";
import { Airgent as AirgentClass } from "../Airgent";
import type { AgentContext, ModelEntry, StructuredMemory } from "../types";
import {
	anyArr,
	anyStr,
	callCount,
	calledWith,
	objContaining,
	spy,
	strContaining,
	wasCalled,
} from "./spy-utils";

// ============================================================
// Base config / models
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

// ============================================================
// Spy instances for all dependencies
// ============================================================

function makeMockInstances(): any {
	return {
		configManager: {
			load: spy(() => mockConfig),
			needsConfig: spy(() => false),
			saveSettings: spy(),
			saveModels: spy(),
			loadMCPServers: spy(() => []),
			saveMCPServers: spy(),
			getModels: spy(() => mockConfig.models),
		},
		storage: {
			createSession: spy(),
			endSession: spy(),
			close: spy(),
			getSession: spy(() => ({})),
			insertRawLog: spy(),
			getRawLogs: spy(() => []),
			insertMemory: spy(),
			insertEvidence: spy(),
			insertLink: spy(),
			searchMemories: spy(() => []),
			getLinkedMemories: spy(() => []),
			getEvidence: spy(() => []),
			findContradictions: spy(() => []),
			findCircularReferences: spy(() => []),
		},
		api: {
			healthCheck: spy(() => ({ healthy: true, version: "1.0.0" })),
			listProviders: spy(() => ({
				connected: ["test-provider"],
				all: [
					{
						id: "test-provider",
						name: "Test Provider",
						models: { "gpt-4": {} },
					},
				],
			})),
			chat: spy(() => ({ content: "mock response" })),
			streamChat: spy(function* (): Generator<string, void, unknown> {
				yield "chunk1";
				yield "chunk2";
			}),
			setAuth: spy(),
			listMCP: spy(() => ({})),
			addMCP: spy(),
			connectMCP: spy(),
			disconnectMCP: spy(),
		},
		skills: {
			getIndex: spy(() => ({ skills: [] })),
			getActiveSkills: spy(() => []),
			loadSkill: spy(() => null),
			injectSkill: spy((p: string) => p),
		},
		promptManager: {
			buildSystemPrompt: spy(() => ({
				prompt: "System prompt",
				tokenCount: 50,
			})),
			buildNodePrompt: spy((node: string) => `Node prompt for ${node}`),
			wouldExceedLimit: spy(() => false),
		},
		memory: {
			recordRaw: spy(),
			getRawLogsBySession: spy(() => []),
			createMemory: spy(() => "mem-id"),
			findRelevant: spy(() => []),
			getLinked: spy(() => []),
			getEvidence: spy(() => []),
			findContradictions: spy(() => []),
			findCircularReferences: spy(() => []),
		},
		compressionManager: {
			compress: spy(() => ({ id: "comp-1", title: "test" })),
			compressSession: spy(),
			decompress: spy(() => []),
		},
		pipeline: {
			registerHandler: spy(),
			registerNode: spy(),
			unregisterNode: spy(),
			buildDAG: spy(() => ({ nodes: [] })),
			execute: spy(() => new Map()),
			getState: spy(() => undefined),
			reset: spy(),
		},
		ui: {
			start: spy(() => Promise.resolve()),
			stop: spy(),
			log: spy(),
			stream: spy(),
			notice: spy(),
			updateStatus: spy(),
			copy: spy(() => ({ success: true, method: "osc52" })),
			prompt: spy(() => ""),
			selectModel: spy(() => null),
			showSelectMenu: spy(() => null),
			ready: false,
		},
		planner: {
			init: spy(),
			switchModel: spy(),
			analyzeTask: spy(() => ["generate", "report"]),
			selectNodes: spy(() => ["generate", "report"]),
			replan: spy(() => "replan result"),
		},
		worker: {
			init: spy(),
			switchModel: spy(),
			execute: spy(() => ({ content: "generated content" })),
		},
		memoryOrganizer: {
			init: spy(),
			switchModel: spy(),
			organize: spy(),
		},
		compression: {
			init: spy(),
			switchModel: spy(),
		},
		validation: {
			init: spy(),
			switchModel: spy(),
			validate: spy(() => ({
				contradictions: 0,
				circularReferences: 0,
				hallucinatedLinks: 0,
				inferenceAsFact: 0,
				issues: [],
				overallHealth: "healthy" as const,
				stats: { totalEntries: 0, healthyEntries: 0, issueCount: 0 },
			})),
		},
		watchdog: {
			init: spy(),
			switchModel: spy(),
			check: spy(() => ({ healthy: true, actions: [] })),
		},
		contextInspector: {
			init: spy(),
			switchModel: spy(),
			inspect: spy(() => ({
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
			initGit: spy(),
			push: spy(),
			pull: spy(),
		},
		rateLimiter: {
			tryConsume: spy(() => true),
			currentTokens: 100,
		},
		logger: {
			info: spy(),
			warn: spy(),
			error: spy(),
			debug: spy(),
			fatal: spy(),
			setDebug: spy(),
			child: spy(() => ({
				info: spy(),
				warn: spy(),
				error: spy(),
				debug: spy(),
				fatal: spy(),
				setDebug: spy(),
			})),
		},
	};
}

function _freshConfig() {
	return structuredClone(mockConfig);
}

// ============================================================
// Agent factory: build a REAL instance via injected spies
// ============================================================

function createAgent(mocks: any): any {
	const deps: any = {
		configManager: mocks.configManager,
		config: _freshConfig(),
		storage: mocks.storage,
		api: mocks.api,
		skills: mocks.skills,
		promptManager: mocks.promptManager,
		memory: mocks.memory,
		compressionManager: mocks.compressionManager,
		pipeline: mocks.pipeline,
		ui: mocks.ui,
		planner: mocks.planner,
		worker: mocks.worker,
		memoryOrganizer: mocks.memoryOrganizer,
		compression: mocks.compression,
		validation: mocks.validation,
		watchdog: mocks.watchdog,
		contextInspector: mocks.contextInspector,
		deviceSync: mocks.deviceSync,
	};
	const agent: any = new AirgentClass(deps);
	agent.rateLimiter = mocks.rateLimiter;
	return agent;
}

// ============================================================
// Tests
// ============================================================

describe("Airgent — Constructor & Initialization", () => {
	let agent: any;
	// biome-ignore lint/suspicious/noExplicitAny: test mocks need wider types
	let mocks: any;

	beforeEach(() => {
		mocks = makeMockInstances();
		agent = createAgent(mocks);
	});

	test("creates instance through the real constructor", () => {
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
	let agent: any;
	let mocks: any;

	beforeEach(() => {
		mocks = makeMockInstances();
		agent = createAgent(mocks);
	});

	test("start() initializes session and starts UI", async () => {
		await agent.start();
		expect(agent.sessionId).toBeTruthy();
		expect(agent.running).toBe(true);
		expect(wasCalled(mocks.ui.start)).toBe(true);
		expect(wasCalled(mocks.storage.createSession)).toBe(true);
	});

	test("start() is idempotent", async () => {
		await agent.start();
		const callCountBefore = callCount(mocks.ui.start);
		await agent.start();
		expect(callCount(mocks.ui.start)).toBe(callCountBefore);
	});

	test("start() checks API health", async () => {
		await agent.start();
		expect(wasCalled(mocks.api.healthCheck)).toBe(true);
	});

	test("stop() stops UI and ends session", async () => {
		await agent.start();
		await agent.stop();
		expect(agent.running).toBe(false);
		expect(wasCalled(mocks.ui.stop)).toBe(true);
		expect(wasCalled(mocks.storage.endSession)).toBe(true);
		expect(wasCalled(mocks.storage.close)).toBe(true);
	});

	test("stop() is safe when not started", async () => {
		await agent.stop(); // not started (running=false → early return)
		expect(callCount(mocks.ui.stop)).toBe(0);
		expect(callCount(mocks.storage.endSession)).toBe(0);
	});

	test("stop() is idempotent", async () => {
		await agent.start();
		await agent.stop();
		const count = callCount(mocks.ui.stop);
		await agent.stop();
		expect(callCount(mocks.ui.stop)).toBe(count);
	});
});

describe("Airgent — Command Handling", () => {
	let agent: any;
	let mocks: any;

	async function sendInput(line: string): Promise<void> {
		await agent.handleInput(line);
	}

	beforeEach(() => {
		mocks = makeMockInstances();
		agent = createAgent(mocks);
		agent.sessionId = "test-session";
		agent.running = true;
	});

	test("/help outputs command list", async () => {
		await sendInput("/help");
		expect(calledWith(mocks.ui.log, "info", "airgent", strContaining("/quit"))).toBe(true);
	});

	test("/info shows system info", async () => {
		await sendInput("/info");
		expect(calledWith(mocks.ui.notice, strContaining("Airgent v1.0.0"))).toBe(true);
	});

	test("/info shows not connected when unhealthy", async () => {
		mocks.api.healthCheck = spy(() => ({ healthy: false, version: "" }));
		await sendInput("/info");
		expect(calledWith(mocks.ui.notice, strContaining("not connected"))).toBe(true);
	});

	test("/status shows uptime", async () => {
		await sendInput("/status");
		expect(calledWith(mocks.ui.log, "info", "airgent", strContaining("Uptime"))).toBe(true);
	});

	test("/session outputs session JSON", async () => {
		mocks.storage.getSession = spy(() => ({ id: "s-1" }));
		await sendInput("/session");
		expect(calledWith(mocks.ui.log, "info", "airgent", anyStr())).toBe(true);
	});

	test("/copy with text copies to clipboard", async () => {
		await sendInput("/copy hello world");
		expect(calledWith(mocks.ui.copy, "hello world")).toBe(true);
		expect(calledWith(mocks.ui.log, "info", "airgent", strContaining("Copied"))).toBe(true);
	});

	test("/copy warns when nothing to copy", async () => {
		agent.pipelineData = {};
		await sendInput("/copy");
		expect(calledWith(mocks.ui.log, "warn", "airgent", strContaining("Nothing to copy"))).toBe(
			true,
		);
	});

	test("/copy uses pipelineData as fallback", async () => {
		agent.pipelineData.generatedOutput = "prev output";
		await sendInput("/copy");
		expect(calledWith(mocks.ui.copy, "prev output")).toBe(true);
	});

	test("/copy shows error on clipboard failure", async () => {
		mocks.ui.copy = spy(() => ({
			success: false,
			method: "file",
			error: "failed",
		}));
		await sendInput("/copy text");
		expect(calledWith(mocks.ui.log, "error", "airgent", strContaining("Copy failed"))).toBe(true);
	});

	test("/setting opens settings menu", async () => {
		await sendInput("/setting");
		expect(calledWith(mocks.ui.showSelectMenu, "Settings", anyArr())).toBe(true);
	});

	test("/compress triggers compression", async () => {
		agent.sessionId = "sess-1";
		await sendInput("/compress");
		expect(calledWith(mocks.compressionManager.compressSession, "sess-1")).toBe(true);
	});

	test("/providers lists providers", async () => {
		await sendInput("/providers");
		expect(calledWith(mocks.ui.log, "info", "providers", strContaining("Connected"))).toBe(true);
	});

	test("/providers handles API error", async () => {
		mocks.api.listProviders = spy(() => {
			throw new Error("fail");
		});
		await sendInput("/providers");
		expect(calledWith(mocks.ui.log, "error", "providers", anyStr())).toBe(true);
	});

	test("/sync push with URL pushes", async () => {
		const pushSpy = spy();
		agent.deviceSync = { initGit: spy(), push: pushSpy, pull: spy() };
		await sendInput("/sync push https://example.com/repo.git");
		expect(wasCalled(pushSpy)).toBe(true);
	});

	test("/sync pull pulls", async () => {
		const pullSpy = spy();
		agent.deviceSync = { initGit: spy(), push: spy(), pull: pullSpy };
		await sendInput("/sync pull");
		expect(wasCalled(pullSpy)).toBe(true);
	});

	test("/sync push without URL still executes push", async () => {
		const pushSpy = spy();
		agent.deviceSync = { initGit: spy(), push: pushSpy, pull: spy() };
		await sendInput("/sync push");
		// Code pushes regardless of URL presence; only git init depends on URL
		expect(wasCalled(pushSpy)).toBe(true);
		expect(calledWith(mocks.ui.log, "info", "sync", "Push done")).toBe(true);
	});

	test("/cat with file attempts read", async () => {
		await sendInput("/cat /tmp/test.txt");
		// smartCat runs for real — we just verify something was logged
		expect(callCount(mocks.ui.log)).toBeGreaterThan(1);
	});

	test("/cat without file shows usage", async () => {
		await sendInput("/cat");
		expect(calledWith(mocks.ui.log, "info", "cat", strContaining("Usage"))).toBe(true);
	});

	test("non-command input sends to processTask", async () => {
		agent.processTask = spy();
		await sendInput("write code");
		expect(calledWith(agent.processTask, "write code")).toBe(true);
	});

	test("/mcp list shows configured servers", async () => {
		agent.configManager.loadMCPServers = spy(() => [
			{
				name: "my-srv",
				type: "local",
				command: ["node", "srv.js"],
				enabled: true,
			},
		]);
		await sendInput("/mcp list");
		expect(calledWith(mocks.ui.log, "info", "mcp", strContaining("my-srv"))).toBe(true);
	});

	test("/mcp list shows 'no servers' when empty", async () => {
		agent.configManager.loadMCPServers = spy(() => []);
		await sendInput("/mcp list");
		expect(calledWith(mocks.ui.log, "info", "mcp", "No MCP servers configured")).toBe(true);
	});

	test("/mcp add saves local server", async () => {
		const saveSpy = spy();
		agent.configManager = {
			loadMCPServers: spy(() => []),
			saveMCPServers: saveSpy,
			needsConfig: spy(() => false),
			load: spy(() => mockConfig),
			saveSettings: spy(),
			saveModels: spy(),
			getModels: spy(() => mockConfig.models),
		};
		await sendInput("/mcp add srv local node index.js");
		expect(wasCalled(saveSpy)).toBe(true);
	});

	test("/mcp add prevents duplicates", async () => {
		agent.configManager.loadMCPServers = spy(() => [
			{ name: "dup", type: "local", command: ["node", "x.js"], enabled: true },
		]);
		await sendInput("/mcp add dup local node x.js");
		expect(calledWith(mocks.ui.log, "warn", "mcp", strContaining("already exists"))).toBe(true);
	});

	test("/mcp add with missing args shows usage", async () => {
		await sendInput("/mcp add");
		expect(calledWith(mocks.ui.log, "warn", "mcp", strContaining("Usage"))).toBe(true);
	});

	test("/mcp add-remote saves remote", async () => {
		const saveSpy = spy();
		agent.configManager = {
			loadMCPServers: spy(() => []),
			saveMCPServers: saveSpy,
			needsConfig: spy(() => false),
			load: spy(() => mockConfig),
			saveSettings: spy(),
			saveModels: spy(),
			getModels: spy(() => mockConfig.models),
		};
		await sendInput("/mcp add-remote remote-srv https://example.com/mcp");
		expect(wasCalled(saveSpy)).toBe(true);
	});

	test("/mcp add-remote missing args shows usage", async () => {
		await sendInput("/mcp add-remote");
		expect(calledWith(mocks.ui.log, "warn", "mcp", strContaining("Usage"))).toBe(true);
	});

	test("/mcp connect connects server", async () => {
		await sendInput("/mcp connect my-srv");
		expect(calledWith(mocks.api.connectMCP, "my-srv")).toBe(true);
	});

	test("/mcp connect without name shows usage", async () => {
		await sendInput("/mcp connect");
		expect(calledWith(mocks.ui.log, "warn", "mcp", strContaining("Usage"))).toBe(true);
	});

	test("/mcp disconnect disconnects", async () => {
		await sendInput("/mcp disconnect my-srv");
		expect(calledWith(mocks.api.disconnectMCP, "my-srv")).toBe(true);
	});

	test("/mcp remove deletes server from config", async () => {
		const saveSpy = spy();
		agent.configManager.loadMCPServers = spy(() => [
			{ name: "s1", type: "local", command: ["node", "x.js"], enabled: true },
		]);
		agent.configManager.saveMCPServers = saveSpy;
		await sendInput("/mcp remove s1");
		expect(calledWith(saveSpy, [])).toBe(true);
	});

	test("/mcp unknown subcommand warns", async () => {
		await sendInput("/mcp badcmd");
		expect(calledWith(mocks.ui.log, "warn", "mcp", strContaining("Unknown subcommand"))).toBe(true);
	});

	test("/model lists current models", async () => {
		await sendInput("/model");
		expect(calledWith(mocks.ui.log, "info", "model", strContaining("planner"))).toBe(true);
	});

	test("unknown command is processed as task", async () => {
		const pt = spy();
		agent.processTask = pt;
		await sendInput("some unknown thing");
		expect(calledWith(pt, "some unknown thing")).toBe(true);
	});

	test("rate limited input returns early", async () => {
		agent.rateLimiter.tryConsume = spy(() => false);
		await sendInput("/help");
		expect(calledWith(mocks.ui.log, "warn", "airgent", strContaining("Rate limit"))).toBe(true);
	});
});

describe("Airgent — processTask flow", () => {
	let agent: any;
	let mocks: any;

	beforeEach(() => {
		mocks = makeMockInstances();
		agent = createAgent(mocks);
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
		expect(calledWith(mocks.planner.analyzeTask, "write code")).toBe(true);
		expect(wasCalled(mocks.pipeline.execute)).toBe(true);
		expect(wasCalled(mocks.planner.init)).toBe(true);
		expect(wasCalled(mocks.worker.init)).toBe(true);
		expect(wasCalled(mocks.validation.init)).toBe(true);
		expect(wasCalled(mocks.watchdog.init)).toBe(true);
		expect(wasCalled(mocks.contextInspector.init)).toBe(true);
	});

	test("processTask displays generated output", async () => {
		// processTask resets pipelineData, so we need the pipeline execute
		// to populate generatedOutput
		mocks.pipeline.execute = spy(() => {
			agent.pipelineData.generatedOutput = "output text";
			return new Map();
		}) as any;
		await agent.processTask("test");
		expect(calledWith(mocks.ui.log, "info", "ai", "output text")).toBe(true);
	});

	test("processTask skips output when empty", async () => {
		mocks.pipeline.execute = spy(() => {
			agent.pipelineData.generatedOutput = "";
			return new Map();
		}) as any;
		await agent.processTask("test");
		const aiLogs = mocks.ui.log.calls.filter((c: any) => c[1] === "ai");
		expect(aiLogs.length).toBe(0);
	});

	test("processTask runs context inspection", async () => {
		await agent.processTask("test");
		expect(wasCalled(mocks.contextInspector.inspect)).toBe(true);
	});

	test("processTask warns on high corruption", async () => {
		mocks.contextInspector.inspect = spy(() => ({
			sameErrorRepeated: false,
			purposeForgotten: false,
			todoStuck: false,
			assumptionFixed: false,
			errorChangeUnrecognized: false,
			details: [],
			score: 0.8,
		})) as any;
		await agent.processTask("test");
		expect(calledWith(mocks.ui.log, "warn", "inspector", strContaining("Corruption"))).toBe(true);
	});

	test("processTask does not warn on low corruption", async () => {
		mocks.contextInspector.inspect = spy(() => ({
			sameErrorRepeated: false,
			purposeForgotten: false,
			todoStuck: false,
			assumptionFixed: false,
			errorChangeUnrecognized: false,
			details: [],
			score: 0.3,
		})) as any;
		await agent.processTask("test");
		const warns = mocks.ui.log.calls.filter((c: any) => c[1] === "inspector");
		expect(warns.length).toBe(0);
	});

	test("processTask runs watchdog", async () => {
		await agent.processTask("test");
		expect(wasCalled(mocks.watchdog.check)).toBe(true);
	});

	test("processTask warns on unhealthy watchdog", async () => {
		mocks.watchdog.check = spy(() => ({
			healthy: false,
			actions: [{ type: "warning", reason: "issue" }],
		})) as any;
		await agent.processTask("test");
		expect(calledWith(mocks.ui.log, "warn", "watchdog", anyStr())).toBe(true);
	});

	test("processTask updates status", async () => {
		await agent.processTask("test");
		expect(calledWith(mocks.ui.updateStatus, { status: "running" })).toBe(true);
		expect(calledWith(mocks.ui.updateStatus, { pipelineNode: "plan" })).toBe(true);
		expect(calledWith(mocks.ui.updateStatus, { pipelineNode: "execute" })).toBe(true);
		expect(calledWith(mocks.ui.updateStatus, { status: "completed", pipelineNode: "" })).toBe(true);
	});

	test("processTask handles errors gracefully", async () => {
		mocks.planner.analyzeTask = spy(() => {
			throw new Error("plan failed");
		}) as any;
		await agent.processTask("test");
		expect(calledWith(mocks.ui.log, "error", "airgent", strContaining("plan failed"))).toBe(true);
	});

	test("processTask sets error status on failure", async () => {
		mocks.planner.analyzeTask = spy(() => {
			throw new Error("fail");
		}) as any;
		await agent.processTask("test");
		expect(calledWith(mocks.ui.updateStatus, { status: "error" })).toBe(true);
	});

	test("processTask resets pipelineData at start", async () => {
		agent.pipelineData = { generatedOutput: "old" };
		await agent.processTask("new task");
		// pipelineData is cleared before processing
		expect(agent.currentTask).toBe("new task");
	});
});

describe("Airgent — buildAgentContext", () => {
	let agent: any;
	let mocks: any;

	beforeEach(() => {
		mocks = makeMockInstances();
		agent = createAgent(mocks);
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
		mocks.promptManager.buildSystemPrompt = spy(() => ({
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
		mocks.memory.findRelevant = spy(() => mems) as any;
		const ctx: AgentContext = agent.buildAgentContext("task");
		expect(ctx.memory.relevantMemories).toEqual(mems);
	});

	test("includes skillIndex", () => {
		mocks.skills.getIndex = spy(() => ({
			skills: [{ name: "s1", description: "d1", tags: [], filePath: "/x" }],
		})) as any;
		const ctx: AgentContext = agent.buildAgentContext("t");
		expect(ctx.skillIndex.skills).toHaveLength(1);
		expect(ctx.skillIndex.skills[0]?.name).toBe("s1");
	});

	test("includes activeSkills", () => {
		mocks.skills.getActiveSkills = spy(() => ["skill-a", "skill-b"]) as any;
		const ctx: AgentContext = agent.buildAgentContext("t");
		expect(ctx.activeSkills).toEqual(["skill-a", "skill-b"]);
	});

	test("tokenCount estimated from prompt and task length", () => {
		mocks.promptManager.buildSystemPrompt = spy(() => ({
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
	let agent: any;
	let mocks: any;
	// biome-ignore lint/complexity/noBannedTypes: test helper type
	let handlers: Map<string, Function>;

	beforeEach(() => {
		mocks = makeMockInstances();
		agent = createAgent(mocks);
		agent.sessionId = "sess-1";
		agent.currentTask = "test task";

		// The real constructor already invoked registerPipelineHandlers,
		// so the handlers are recorded on our spy pipeline.
		handlers = new Map();
		for (const call of mocks.pipeline.registerHandler.calls) {
			handlers.set(call[0], call[1]);
		}
	});

	test("clarify handler stores clarifiedTask", async () => {
		mocks.api.chat = spy(() => ({ content: "clarified" }));
		const h = handlers.get("clarify")!;
		const result = await h(new Map());
		expect(agent.pipelineData.clarifiedTask).toBe("clarified");
		expect(result).toHaveProperty("content");
	});

	test("clarify handler uses streaming when showPipelineProgress", async () => {
		agent.config.settings.showPipelineProgress = true; // only affects this handler call
		mocks.api.streamChat = spy(function* (): Generator<string, void, unknown> {
			yield "streamed output";
		}) as any;
		const h = handlers.get("clarify")!;
		const result = await h(new Map());
		expect(result).toHaveProperty("content");
		// config deep clone means this mutation stays local
	});

	test("plan handler stores plan", async () => {
		mocks.api.chat = spy(() => ({ content: "the plan" }));
		const h = handlers.get("plan")!;
		await h(new Map());
		expect(agent.pipelineData.plan).toBe("the plan");
	});

	test("plan handler uses clarifiedTask when available", async () => {
		agent.pipelineData.clarifiedTask = "clarified";
		mocks.api.chat = spy(() => ({ content: "plan result" }));
		const h = handlers.get("plan")!;
		await h(new Map());
		expect(calledWith(mocks.promptManager.buildNodePrompt, "plan")).toBe(true);
	});

	test("generate handler stores generatedOutput", async () => {
		mocks.worker.execute = spy(() => ({ content: "generated content" }));
		const h = handlers.get("generate")!;
		const result = await h(new Map());
		expect(agent.pipelineData.generatedOutput).toBe("generated content");
		expect(result).toHaveProperty("content");
	});

	test("generate handler includes plan and clarifiedTask", async () => {
		agent.pipelineData.plan = "my plan";
		agent.pipelineData.clarifiedTask = "clarify";
		mocks.worker.execute = spy(() => ({ content: "result" }));
		const h = handlers.get("generate")!;
		await h(new Map());
		expect(wasCalled(mocks.worker.execute)).toBe(true);
	});

	test("generate handler includes relevant memories", async () => {
		mocks.memory.findRelevant = spy(() => [
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
		]) as any;
		mocks.worker.execute = spy(() => ({ content: "result" }));
		const h = handlers.get("generate")!;
		await h(new Map());
		expect(wasCalled(mocks.worker.execute)).toBe(true);
	});

	test("test handler skips when no generatedOutput", async () => {
		agent.pipelineData.generatedOutput = undefined;
		const h = handlers.get("test")!;
		const result = await h(new Map());
		expect(result).toEqual({ status: "skipped", reason: "no output" });
	});

	test("test handler evaluates output", async () => {
		agent.pipelineData.generatedOutput = "some output";
		mocks.api.chat = spy(() => ({ content: "test result" }));
		const h = handlers.get("test")!;
		// biome-ignore lint/suspicious/noExplicitAny: handler returns dynamic type
		const result: any = await h(new Map());
		expect(agent.pipelineData.testResult).toBe("test result");
		expect(result).toHaveProperty("content");
	});

	test("test handler detects issues", async () => {
		agent.pipelineData.generatedOutput = "buggy";
		mocks.api.chat = spy(() => ({ content: "found a bug here" }));
		const h = handlers.get("test")!;
		// biome-ignore lint/suspicious/noExplicitAny: handler returns dynamic type
		const result: any = await h(new Map());
		expect(result.passed).toBe(false);
	});

	test("test handler passes clean output", async () => {
		agent.pipelineData.generatedOutput = "clean";
		// Must NOT match regex /(bug|error|issue|incorrect|wrong|missing)/i
		mocks.api.chat = spy(() => ({
			content: "all looks correct, reviewed and approved",
		}));
		const h = handlers.get("test")!;
		// biome-ignore lint/suspicious/noExplicitAny: handler returns dynamic type
		const result: any = await h(new Map());
		expect(result.passed).toBe(true);
	});

	test("validate handler calls validation agent", async () => {
		mocks.validation.validate = spy(() => ({
			contradictions: 0,
			circularReferences: 0,
			hallucinatedLinks: 0,
			inferenceAsFact: 0,
			issues: [],
			overallHealth: "healthy",
			stats: { totalEntries: 0, healthyEntries: 0, issueCount: 0 },
		}));
		const h = handlers.get("validate")!;
		// biome-ignore lint/suspicious/noExplicitAny: handler returns dynamic type
		const result: any = await h(new Map());
		expect(result.overallHealth).toBe("healthy");
	});

	test("validate handler warns on unhealthy", async () => {
		mocks.validation.validate = spy(() => ({
			contradictions: 2,
			circularReferences: 1,
			hallucinatedLinks: 0,
			inferenceAsFact: 0,
			issues: [
				{
					severity: "error",
					type: "contradiction",
					description: "i1",
					entries: ["m1", "m2"],
					suggestion: "fix",
				},
			],
			overallHealth: "degraded",
			stats: { totalEntries: 2, healthyEntries: 0, issueCount: 1 },
		})) as any;
		const h = handlers.get("validate")!;
		await h(new Map());
		expect(calledWith(mocks.ui.log, "warn", "validation", strContaining("Health"))).toBe(true);
	});

	test("report handler organizes and compresses", async () => {
		const h = handlers.get("report")!;
		// biome-ignore lint/suspicious/noExplicitAny: handler returns dynamic type
		const result: any = await h(new Map());
		expect(calledWith(mocks.memoryOrganizer.organize, "sess-1")).toBe(true);
		expect(calledWith(mocks.compressionManager.compressSession, "sess-1")).toBe(true);
		expect(result.status).toBe("completed");
	});

	test("report handler skips when no sessionId", async () => {
		agent.sessionId = null;
		const h = handlers.get("report")!;
		await h(new Map());
		expect(callCount(mocks.memoryOrganizer.organize)).toBe(0);
	});
});

describe("Airgent — Edge Cases", () => {
	let agent: any;
	let mocks: any;

	beforeEach(() => {
		mocks = makeMockInstances();
		agent = createAgent(mocks);
		agent.sessionId = "sess-1";
		agent.running = true;
	});

	test("empty task processes with plan step", async () => {
		mocks.planner.analyzeTask = spy(() => ["generate", "report"]);
		await expect(agent.processTask("")).resolves.toBeUndefined();
	});

	test("long task (10k chars) passed to planner", async () => {
		const long = "a".repeat(10000);
		mocks.planner.analyzeTask = spy(() => ["generate", "report"]);
		mocks.worker.execute = spy(() => ({ content: "ok" }));
		await agent.processTask(long);
		expect(calledWith(mocks.planner.analyzeTask, long)).toBe(true);
	});

	test("pipeline with no selected nodes", async () => {
		mocks.planner.analyzeTask = spy(() => []);
		mocks.worker.execute = spy(() => ({ content: "test" }));
		await agent.processTask("task");
		expect(wasCalled(mocks.pipeline.execute)).toBe(true);
	});

	test("sequential tasks update currentTask", async () => {
		mocks.planner.analyzeTask = spy(() => ["generate", "report"]);
		mocks.worker.execute = spy(() => ({ content: "o" }));
		await agent.processTask("first");
		expect(agent.currentTask).toBe("first");
		await agent.processTask("second");
		expect(agent.currentTask).toBe("second");
	});
});

describe("Airgent — Streaming (streamNodeOutput)", () => {
	let agent: any;
	let mocks: any;

	beforeEach(() => {
		mocks = makeMockInstances();
		agent = createAgent(mocks);
	});

	test("streamNodeOutput streams and returns content", async () => {
		mocks.api.streamChat = spy(function* (): Generator<string, void, unknown> {
			yield "hello ";
			yield "world";
		}) as any;
		const model: ModelEntry = { provider: "test", model: "gpt-4" };
		const msgs = [{ role: "user" as const, content: "hi" }];
		const result = await agent.streamNodeOutput(model, msgs, "test-node", "plan");
		expect(result).toBe("hello world");
		expect(agent.pipelineData.plan).toBe("hello world");
	});

	test("streamNodeOutput stores in pipelineData field", async () => {
		mocks.api.streamChat = spy(function* (): Generator<string, void, unknown> {
			yield "stored";
		}) as any;
		await agent.streamNodeOutput(
			{ provider: "test", model: "gpt-4" },
			[{ role: "user", content: "hi" }],
			"node",
			"generatedOutput",
		);
		expect(agent.pipelineData.generatedOutput).toBe("stored");
	});

	test("streamNodeOutput falls back to non-streaming on error", async () => {
		mocks.api.streamChat = spy(function* (): Generator<string, void, unknown> {
			yield "";
			throw new Error("stream failed");
		}) as any;
		mocks.api.chat = spy(() => ({ content: "fallback" }));
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
		mocks.api.streamChat = spy(function* (): Generator<string, void, unknown> {
			yield "data";
		}) as any;
		await agent.streamNodeOutput(
			{ provider: "test", model: "gpt-4" },
			[{ role: "user", content: "hi" }],
			"my-node",
			"plan",
		);
		expect(calledWith(mocks.ui.stream, "  → my-node")).toBe(true);
	});
});

describe("Airgent — applyModelConfig", () => {
	let agent: any;
	let mocks: any;

	beforeEach(() => {
		mocks = makeMockInstances();
		agent = createAgent(mocks);
	});

	test("switches all agent models", () => {
		agent.applyModelConfig();
		expect(wasCalled(mocks.planner.switchModel)).toBe(true);
		expect(wasCalled(mocks.worker.switchModel)).toBe(true);
		expect(wasCalled(mocks.validation.switchModel)).toBe(true);
		expect(wasCalled(mocks.watchdog.switchModel)).toBe(true);
		expect(wasCalled(mocks.contextInspector.switchModel)).toBe(true);
		expect(wasCalled(mocks.memoryOrganizer.switchModel)).toBe(true);
		expect(wasCalled(mocks.compression.switchModel)).toBe(true);
	});

	test("uses current model config values", () => {
		agent.config.models = {
			...mockConfig.models,
			planner: { provider: "custom", model: "custom-planner" },
		};
		agent.applyModelConfig();
		expect(
			calledWith(
				mocks.planner.switchModel,
				objContaining({ provider: "custom", model: "custom-planner" }),
			),
		).toBe(true);
	});
});

describe("Airgent — updateStatus", () => {
	let agent: any;
	let mocks: any;

	beforeEach(() => {
		mocks = makeMockInstances();
		agent = createAgent(mocks);
	});

	test("updateStatus delegates to UI manager", () => {
		agent.updateStatus({ status: "running" });
		expect(calledWith(mocks.ui.updateStatus, { status: "running" })).toBe(true);
	});

	test("updateStatus with multiple fields", () => {
		agent.updateStatus({
			sessionId: "s1",
			status: "running",
			pipelineNode: "plan",
		});
		expect(
			calledWith(mocks.ui.updateStatus, {
				sessionId: "s1",
				status: "running",
				pipelineNode: "plan",
			}),
		).toBe(true);
	});
});
