/**
 * Airgent - Main Orchestrator
 *
 * Wires together all subsystems. Delegates heavy logic to extracted modules.
 */

import { randomUUID } from "node:crypto";
import { CompressionAgent } from "./agents/compression";
import { ContextInspectorAgent } from "./agents/context-inspector";
import { MemoryOrganizerAgent } from "./agents/memory-organizer";
import { PlannerAgent } from "./agents/planner";
import { ValidationAgent } from "./agents/validation";
import { WatchdogAgent } from "./agents/watchdog";
import { WorkerAgent } from "./agents/worker";
import { OpenCodeAPI } from "./api/opencode";
import {
	configureModelForAll as delegateConfigureModelForAll,
	configureModelForRole as delegateConfigureModelForRole,
	configureModels as delegateConfigureModels,
	handleInput as delegateInput,
} from "./commands/index";
import { CompressionManager } from "./compression/index";
import { ConfigManager } from "./config/index";
import { callLLM } from "./llm";
import { MemorySystem } from "./memory/index";
import { registerPipelineHandlers } from "./pipeline/handlers";
import { PipelineEngine } from "./pipeline/index";
import { PromptManager } from "./prompt/index";
import { ensureOpenCodeServer } from "./server/index";
import { SkillsManager } from "./skills/index";
import { Storage } from "./storage/index";
import { DeviceSync } from "./sync/index";
import type { AgentContext, ModelEntry, ModelRole } from "./types";
import type { StatusInfo } from "./ui/index";
import { UIManager } from "./ui/index";
import { rootLogger, sanitizeError } from "./utils/logger";
import { RateLimiter } from "./utils/rate-limiter";

export class Airgent {
	configManager = new ConfigManager();
	config = this.configManager.load();
	storage = new Storage();
	api = new OpenCodeAPI();
	skills = new SkillsManager();
	promptManager = new PromptManager(this.config, this.skills);
	memory = new MemorySystem(this.storage);
	compressionManager = new CompressionManager(this.memory, this.storage);
	pipeline = new PipelineEngine();
	ui = new UIManager({
		refreshIntervalMs: this.config.settings.uiRefreshIntervalMs,
		onInput: (line) => this.handleInput(line),
		onShutdown: () => this.stop(),
	});

	planner = new PlannerAgent(this.config.models.planner, this.api);
	worker = new WorkerAgent(
		this.config.models.generate,
		this.api,
		this.compressionManager,
		this.skills,
		this.memory,
	);
	memoryOrganizer = new MemoryOrganizerAgent(this.config.models.validation, this.api, this.memory);
	compression = new CompressionAgent(
		this.config.models.compression,
		this.api,
		this.compressionManager,
		this.memory,
	);
	validation = new ValidationAgent(this.config.models.validation, this.api, this.memory);
	watchdog = new WatchdogAgent(this.config.models.watchdog, this.api);
	contextInspector = new ContextInspectorAgent(this.config.models.validation, this.api);

	sessionId: string | null = null;
	running = false;
	_startTime = Date.now();
	currentTask = "";
	deviceSync = new DeviceSync(this.storage);
	opencodeProcess: import("bun").Subprocess | null = null;
	rateLimiter = new RateLimiter(100, 1000, 100);
	private logger = rootLogger.child("airgent");
	pipelineData: {
		clarifiedTask?: string;
		plan?: string;
		generatedOutput?: string;
		testResult?: string;
	} = {};

	constructor() {
		rootLogger.setDebug(this.config.settings.debug);
		this.registerPipelineHandlers();
		this.logger.info("Airgent initialized");
	}

	get startTime(): number {
		return this._startTime;
	}

	async start(): Promise<void> {
		if (this.running) return;
		this.running = true;
		this._startTime = Date.now();
		this.sessionId = randomUUID();
		await this.ui.start();

		await ensureOpenCodeServer(this);

		this.storage.createSession(this.sessionId, this.config.models.generate.model);
		this.ui.ready = true;
		this.ui.log("info", "airgent", "Airgent started");

		if (this.configManager.firstRun) {
			this.ui.log("info", "airgent", "Alpha Release");
			this.ui.log("info", "airgent", "APIs and behavior may change.");
			this.ui.log("info", "airgent", "Feedback and bug reports are welcome.");
		}

		this.updateStatus({ sessionId: this.sessionId, status: "idle" });
		this.logger.info(`Session: ${this.sessionId}`);
	}

	async stop(): Promise<void> {
		if (!this.running) return;
		this.running = false;
		if (this.sessionId) this.storage.endSession(this.sessionId, "completed");
		this.ui.stop();
		this.opencodeProcess?.kill();
		this.opencodeProcess = null;
		this.storage.close();
	}

	async handleInput(line: string): Promise<void> {
		if (!this.rateLimiter.tryConsume()) {
			this.ui.log("warn", "airgent", "Rate limit exceeded. Slow down.");
			return;
		}
		await delegateInput(this, line);
	}

	async processTask(task: string): Promise<void> {
		if (!this.sessionId) throw new Error("Not started");

		this.currentTask = task;
		this.pipelineData = {};
		this.updateStatus({ status: "running" });
		this.ui.log("info", "airgent", "Processing task...");

		try {
			const context = this.buildAgentContext(task);
			this.planner.init(context);
			this.worker.init(context);
			this.compression.init(context);
			this.validation.init(context);
			this.watchdog.init(context);
			this.contextInspector.init(context);

			this.updateStatus({ pipelineNode: "plan" });
			const selectedNodes = await this.planner.analyzeTask(task);
			this.ui.log("info", "planner", `Nodes: ${selectedNodes.join(", ")}`);

			const dag = this.pipeline.buildDAG(selectedNodes);

			this.updateStatus({ pipelineNode: "execute" });
			await this.pipeline.execute(this.sessionId, dag);

			if (this.pipelineData.generatedOutput) {
				this.ui.log("info", "ai", this.pipelineData.generatedOutput);
			}

			const inspResult = this.contextInspector.inspect({
				currentFocus: task,
				errors: [],
				todos: [],
				messages: [],
			});
			if (inspResult.score > 0.5) {
				this.ui.log("warn", "inspector", `Corruption score: ${inspResult.score.toFixed(2)}`);
			}

			const wdResult = this.watchdog.check({ failures: {}, retries: {} });
			if (!wdResult.healthy) {
				this.ui.log("warn", "watchdog", wdResult.actions.map((a) => a.type).join(", "));
			}

			this.updateStatus({ status: "completed", pipelineNode: "" });
			this.ui.log("info", "airgent", "Task completed");
		} catch (err) {
			this.ui.log("error", "airgent", sanitizeError(err));
			this.updateStatus({ status: "error" });
		}
	}

	buildAgentContext(task: string): AgentContext {
		const { prompt } = this.promptManager.buildSystemPrompt();
		const memories = this.memory.findRelevant([task]);

		return {
			sessionId: this.sessionId!,
			messages: [
				{
					id: randomUUID(),
					role: "user",
					content: task,
					timestamp: Date.now(),
				},
			],
			systemPrompt: prompt,
			skillIndex: this.skills.getIndex(),
			activeSkills: this.skills.getActiveSkills(),
			memory: {
				relevantMemories: memories,
				recentRawLogs: [],
				compressedEntries: [],
			},
			state: { task, startTime: Date.now() },
			tokenCount: Math.ceil((prompt.length + task.length) / 4),
		};
	}

	async chatWithQuestion(
		model: ModelEntry,
		messages: Array<{ role: string; content: string }>,
	): Promise<string> {
		return callLLM({
			model,
			messages,
			api: this.api,
			onQuestion: (q) => this.ui.askQuestion(q),
		});
	}

	async streamNodeOutput(
		model: ModelEntry,
		messages: Array<{ role: string; content: string }>,
		nodeName: string,
		dstField: keyof typeof this.pipelineData,
	): Promise<string> {
		this.ui.stream(`  → ${nodeName}`);
		const content = await callLLM({
			model,
			messages,
			api: this.api,
			onChunk: (chunk: string) => this.ui.stream(`    ${chunk}`),
		});
		this.pipelineData[dstField] = content;
		return content;
	}

	registerPipelineHandlers(): void {
		registerPipelineHandlers(this);
	}

	async configureModels(): Promise<void> {
		await delegateConfigureModels(this);
	}

	async configureModelForRole(role: ModelRole): Promise<void> {
		await delegateConfigureModelForRole(this, role);
	}

	async configureModelForAll(): Promise<void> {
		await delegateConfigureModelForAll(this);
	}

	applyModelConfig(): void {
		const m = this.config.models;
		this.planner.switchModel(m.planner);
		this.worker.switchModel(m.generate);
		this.memoryOrganizer.switchModel(m.validation);
		this.compression.switchModel(m.compression);
		this.validation.switchModel(m.validation);
		this.watchdog.switchModel(m.watchdog);
		this.contextInspector.switchModel(m.validation);
	}

	updateStatus(partial: Partial<StatusInfo>): void {
		this.ui.updateStatus(partial);
	}
}
