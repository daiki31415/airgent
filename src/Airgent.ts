/**
 * Airgent - Main Orchestrator
 *
 * Wires together all subsystems. Pipeline handlers are registered
 * in the constructor so processTask delegates execution to the DAG.
 */

import { randomUUID } from "node:crypto";
import { ConfigManager } from "./config/index";
import { Storage } from "./storage/index";
import { OpenCodeAPI } from "./api/opencode";
import { DeviceSync } from "./sync/index";
import { smartCat } from "./utils/smart-cat";
import { PlannerAgent } from "./agents/planner";
import { WorkerAgent } from "./agents/worker";
import { MemoryOrganizerAgent } from "./agents/memory-organizer";
import { CompressionAgent } from "./agents/compression";
import { ValidationAgent } from "./agents/validation";
import { WatchdogAgent } from "./agents/watchdog";
import { ContextInspectorAgent } from "./agents/context-inspector";
import { PipelineEngine, buildDAG } from "./pipeline/index";
import { MemorySystem } from "./memory/index";
import { CompressionManager } from "./compression/index";
import { SkillsManager } from "./skills/index";
import { PromptManager } from "./prompt/index";
import { UIManager } from "./ui/index";
import { rootLogger, sanitizeError } from "./utils/logger";
import { RateLimiter } from "./utils/rate-limiter";
import type { AgentContext, ModelConfig, ModelEntry } from "./types";
import type { StatusInfo } from "./ui/index";

type ModelRole = "planner" | "generate" | "compression" | "validation" | "watchdog";

const ROLE_CONFIGS: Array<{ key: ModelRole; label: string }> = [
  { key: "planner", label: "Planner (task decomposition)" },
  { key: "generate", label: "Generate (primary generation)" },
  { key: "compression", label: "Compression (context compression)" },
  { key: "validation", label: "Validation (quality check)" },
  { key: "watchdog", label: "Watchdog (error detection)" },
];

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
  });

  private planner = new PlannerAgent(this.config.models.planner, this.api);
  private worker = new WorkerAgent(this.config.models.generate, this.api, this.compressionManager, this.skills, this.memory);
  private memoryOrganizer = new MemoryOrganizerAgent(this.config.models.validation, this.api, this.memory);
  private compression = new CompressionAgent(this.config.models.compression, this.api, this.compressionManager, this.memory);
  private validation = new ValidationAgent(this.config.models.validation, this.api, this.memory);
  private watchdog = new WatchdogAgent(this.config.models.watchdog, this.api);
  private contextInspector = new ContextInspectorAgent(this.config.models.validation, this.api);

  private sessionId: string | null = null;
  private running = false;
  private _startTime = Date.now();
  private currentTask = "";
  private deviceSync = new DeviceSync(this.storage);
  private opencodeProcess: import("bun").Subprocess | null = null;
  private rateLimiter = new RateLimiter(100, 1000, 100);
  private logger = rootLogger.child("airgent");
  private pipelineData: {
    clarifiedTask?: string;
    plan?: string;
    prompt?: string;
    generatedOutput?: string;
    testResult?: string;
  } = {};

  constructor() {
    rootLogger.setDebug(this.config.settings.debug);
    this.registerPipelineHandlers();
    this.logger.info("Airgent initialized");
  }

  get startTime(): number { return this._startTime; }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this._startTime = Date.now();
    this.sessionId = randomUUID();
    await this.ui.start();

    // Check OpenCode server - auto-start if not running
    let health = await this.api.healthCheck();
    if (!health.healthy) {
      this.ui.log("info", "airgent", "Starting OpenCode server...");
      const SAFE_ENV_KEYS = [
        "HOME", "PATH", "USER", "SHELL", "TERM", "LANG",
        "OPENCODE_SERVER_PASSWORD", "OPENCODE_SERVER_USERNAME",
        "OPENCODE_BASE_URL", "NODE_ENV",
      ];
      const safeEnv: Record<string, string> = {};
      for (const key of SAFE_ENV_KEYS) {
        if (process.env[key]) safeEnv[key] = process.env[key]!;
      }
      try {
        const proc = Bun.spawn(["opencode", "serve"], {
          env: safeEnv,
          stdout: "pipe",
          stderr: "pipe",
        });
        this.opencodeProcess = proc;

        const decoder = new TextDecoder();
        (async () => {
          const reader = proc.stdout.getReader();
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            for (const line of decoder.decode(value).split("\n").filter(Boolean)) {
              this.ui.log("info", "opencode", line);
            }
          }
        })();
        (async () => {
          const reader = proc.stderr.getReader();
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            for (const line of decoder.decode(value).split("\n").filter(Boolean)) {
              this.ui.log("error", "opencode", line);
            }
          }
        })();

        // Wait for server to be ready
        for (let i = 0; i < 30; i++) {
          await new Promise(r => setTimeout(r, 500));
          if (i % 5 === 0 && this.opencodeProcess) {
            this.ui.log("info", "airgent", `Waiting for opencode server... (${(i + 1) * 0.5}s)`);
          }
          health = await this.api.healthCheck();
          if (health.healthy) break;
        }
      } catch (err) {
        this.ui.log("error", "airgent", `Failed to start OpenCode server: ${sanitizeError(err)}`);
      }
    }

    if (health.healthy) {
      this.ui.log("info", "airgent", "OpenCode server connected" + (health.version ? " v" + health.version : ""));
    } else {
      this.ui.log("warn", "airgent", "OpenCode server not reachable. Set OPENCODE_SERVER_PASSWORD and run: opencode serve");
    }

    // Model configuration wizard (first-run)
    if (health.healthy && this.configManager.needsConfig()) {
      await this.configureModels();
    }

    this.storage.createSession(this.sessionId, this.config.models.generate.model);
    this.ui.ready = true;
    this.ui.log("info", "airgent", "Airgent started");
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

  private async handleInput(line: string): Promise<void> {
    if (!this.rateLimiter.tryConsume()) {
      this.ui.log("warn", "airgent", "Rate limit exceeded. Slow down.");
      return;
    }
    this.ui.log("info", "user", line);
    const lower = line.toLowerCase();

    if (lower.startsWith("/")) {
      const [cmd, ...args] = lower.split(/\s+/);
      switch (cmd) {
        case "/quit": case "/exit":
          await this.stop();
          process.exit(0);
          return;
        case "/help":
          this.ui.log("info", "airgent", "/quit /model /config /status /session /compress /providers /sync /cat <file>");
          return;
        case "/info": {
          const health = await this.api.healthCheck();
          this.ui.notice("Commands: /quit /help /status /info /session /compress /providers /sync /cat");
          this.ui.notice("Airgent v1.0.0");
          this.ui.notice(
            health.healthy
              ? `OpenCode v${health.version || "?"} (connected)`
              : "OpenCode (not connected)"
          );
          return;
        }
        case "/status":
          this.ui.log("info", "airgent", `Uptime: ${Date.now() - this._startTime}ms | Session: ${this.sessionId || "none"}`);
          return;
        case "/session":
          this.ui.log("info", "airgent", JSON.stringify(this.storage.getSession(this.sessionId || "")));
          return;
        case "/model":
          await this.handleModelCommand(args);
          return;
        case "/compress":
          if (this.sessionId) await this.compressionManager.compressSession(this.sessionId);
          this.ui.log("info", "airgent", "Compression done");
          return;
        case "/providers":
          try {
            const providers = await this.api.listProviders();
            this.ui.log("info", "providers", "Connected: " + providers.connected.join(", "));
            this.ui.log("info", "providers", "Available: " + providers.all.map(p => p.id).join(", "));
          } catch (err) {
            this.ui.log("error", "providers", sanitizeError(err));
          }
          return;
        case "/sync":
          if (args[0] === "push") {
            const url = args.slice(1).join(" ");
            if (url) this.deviceSync.initGit(url);
            try { this.deviceSync.push(); this.ui.log("info", "sync", "Push done"); }
            catch (err) { this.ui.log("error", "sync", sanitizeError(err)); }
          } else if (args[0] === "pull") {
            try { this.deviceSync.pull(); this.ui.log("info", "sync", "Pull done"); }
            catch (err) { this.ui.log("error", "sync", sanitizeError(err)); }
          } else {
            this.ui.log("info", "sync", "Usage: /sync push <remote-url>  |  /sync pull");
          }
          return;
        case "/cat":
          if (args[0]) {
            try {
              const content = smartCat(line.slice(5).trim());
              this.ui.log("info", "cat", content.slice(0, 2000));
            } catch (err) { this.ui.log("error", "cat", sanitizeError(err)); }
          } else {
            this.ui.log("info", "cat", "Usage: /cat <file>");
          }
          return;
      }
    }

    await this.processTask(line);
  }

  async processTask(task: string): Promise<void> {
    if (!this.sessionId) throw new Error("Not started");

    this.currentTask = task;
    this.pipelineData = {};
    this.updateStatus({ status: "running" });
    this.ui.log("info", "airgent", "Processing task...");

    try {
      // 1. Build context and init agents
      const context = this.buildAgentContext(task);
      this.planner.init(context);
      this.worker.init(context);
      this.compression.init(context);
      this.validation.init(context);
      this.watchdog.init(context);
      this.contextInspector.init(context);

      // 2. Plan
      this.updateStatus({ pipelineNode: "plan" });
      const selectedNodes = await this.planner.analyzeTask(task);
      this.ui.log("info", "planner", `Nodes: ${selectedNodes.join(", ")}`);

      // 3. Build DAG
      const dag = buildDAG(selectedNodes);

      // 3. Execute pipeline (generate → validate → report via DAG)
      this.updateStatus({ pipelineNode: "execute" });
      await this.pipeline.execute(this.sessionId, dag);

      // 4. Display generated output to user
      if (this.pipelineData.generatedOutput) {
        this.ui.log("info", "ai", this.pipelineData.generatedOutput);
      }

      // 5. Context inspection
      const inspResult = this.contextInspector.inspect({
        currentFocus: task, errors: [], todos: [], messages: [],
      });
      if (inspResult.score > 0.5) {
        this.ui.log("warn", "inspector", `Corruption score: ${inspResult.score.toFixed(2)}`);
      }

      // 6. Watchdog
      const wdResult = this.watchdog.check({ failures: {}, retries: {} });
      if (!wdResult.healthy) {
        this.ui.log("warn", "watchdog", wdResult.actions.map(a => a.type).join(", "));
      }

      this.updateStatus({ status: "completed", pipelineNode: "" });
      this.ui.log("info", "airgent", "Task completed");
    } catch (err) {
      this.ui.log("error", "airgent", sanitizeError(err));
      this.updateStatus({ status: "error" });
    }
  }

  private registerPipelineHandlers(): void {
    this.pipeline.registerHandler("clarify", async () => {
      const response = await this.api.chat(this.config.models.planner, [
        { role: "system", content: "You analyze tasks and extract: goal, constraints, affected files, ambiguities. Be concise." },
        { role: "user", content: `Analyze this task:\n${this.currentTask}` },
      ]);
      this.pipelineData.clarifiedTask = response.content;
      this.ui.log("info", "clarify", `Analyzed task`);
      return { content: response.content };
    });

    this.pipeline.registerHandler("plan", async () => {
      const source = this.pipelineData.clarifiedTask || this.currentTask;
      const response = await this.api.chat(this.config.models.planner, [
        { role: "system", content: "You create step-by-step implementation plans. Be specific and actionable." },
        { role: "user", content: `Create a plan based on the requirements:\n\n${source}` },
      ]);
      this.pipelineData.plan = response.content;
      this.ui.log("info", "plan", `Created plan`);
      return { content: response.content };
    });

    this.pipeline.registerHandler("prompt", async () => {
      const memories = this.memory.findRelevant([this.currentTask]).slice(0, 3);
      const memoryStr = memories.map(m => `- ${m.bug}: ${m.fix}`).join("\n");
      const parts = [
        memoryStr ? `Relevant context:\n${memoryStr}` : "",
        this.pipelineData.plan ? `Approach:\n${this.pipelineData.plan}` : "",
        this.pipelineData.clarifiedTask ? `Requirements:\n${this.pipelineData.clarifiedTask}` : "",
        `Task: ${this.currentTask}`,
      ].filter(Boolean);
      this.pipelineData.prompt = parts.join("\n\n");
      this.ui.log("info", "prompt", `Built prompt: ${this.pipelineData.prompt.length} chars`);
      return { content: this.pipelineData.prompt };
    });

    this.pipeline.registerHandler("generate", async () => {
      const generationPrompt = this.pipelineData.prompt || this.currentTask;
      const result = await this.worker.execute(generationPrompt);
      this.pipelineData.generatedOutput = result.content;
      this.ui.log("info", "generate", `Generated: ${result.content.length} chars`);
      return result;
    });

    this.pipeline.registerHandler("test", async () => {
      if (!this.pipelineData.generatedOutput) return { status: "skipped", reason: "no output" };
      const response = await this.api.chat(this.config.models.validation, [
        { role: "system", content: "Review the following output for correctness, edge cases, and potential issues. Be critical but constructive." },
        { role: "user", content: `Task: ${this.currentTask}\n\nOutput:\n${this.pipelineData.generatedOutput.slice(0, 4000)}` },
      ]);
      this.pipelineData.testResult = response.content;
      const hasIssues = /(?:bug|error|issue|incorrect|wrong|missing)/i.test(response.content);
      this.ui.log("info", "test", hasIssues ? `Issues found` : "No issues detected");
      return { content: response.content, passed: !hasIssues };
    });

    this.pipeline.registerHandler("merge", async () => {
      const testStatus = this.pipelineData.testResult
        ? /(?:bug|error|issue|incorrect|wrong|missing)/i.test(this.pipelineData.testResult)
          ? "issues found"
          : "passed"
        : "skipped";
      return {
        status: "completed",
        summary: `Task: ${this.currentTask} | Generated: ${(this.pipelineData.generatedOutput || "").length} chars | Tests: ${testStatus}`,
      };
    });

    this.pipeline.registerHandler("validate", async () => {
      const report = await this.validation.validate();
      if (report.overallHealth !== "healthy") {
        this.ui.log("warn", "validation", `Health: ${report.overallHealth} (${report.issues.length} issues)`);
      }
      return report;
    });

    this.pipeline.registerHandler("report", async () => {
      if (this.sessionId) {
        await this.memoryOrganizer.organize(this.sessionId);
        await this.compressionManager.compressSession(this.sessionId);
      }
      return { status: "completed" };
    });
  }

  private async configureModels(): Promise<void> {
    const entries = await this.fetchModelEntries();
    if (!entries) return;

    this.ui.log("info", "airgent", "Model selection — choose a model for each role:");
    const updates: Partial<ModelConfig> = {};
    for (const { key, label } of ROLE_CONFIGS) {
      const selected = await this.ui.selectModel(label, entries);
      if (!selected) {
        this.ui.log("warn", "airgent", "Skipped " + key);
        continue;
      }
      updates[key] = { ...selected };
    }

    if (Object.keys(updates).length > 0) {
      this.configManager.saveModels({ ...updates, fallback: [] });
      this.applyModelConfig();
      this.ui.notice("Model configuration saved!");
      this.ui.log("info", "airgent", "Changed: " + Object.keys(updates).join(", "));
    }
  }

  private async configureModelForRole(role: ModelRole): Promise<void> {
    const entries = await this.fetchModelEntries();
    if (!entries) return;

    const cfg = ROLE_CONFIGS.find(r => r.key === role)!;
    const selected = await this.ui.selectModel(cfg.label, entries);
    if (!selected) {
      this.ui.log("warn", "airgent", `Model selection for ${role} cancelled`);
      return;
    }

    const update = { [role]: { ...selected } };
    this.configManager.saveModels(update);
    this.applyModelConfig();
    this.ui.notice(`Model for ${role} saved: ${selected.provider}/${selected.model}`);
  }

  private async configureModelForAll(): Promise<void> {
    const entries = await this.fetchModelEntries();
    if (!entries) return;

    const selected = await this.ui.selectModel("Model for all roles", entries);
    if (!selected) {
      this.ui.log("warn", "airgent", "Model selection cancelled");
      return;
    }

    const updates: Partial<ModelConfig> = {};
    for (const { key } of ROLE_CONFIGS) {
      updates[key] = { ...selected };
    }
    this.configManager.saveModels(updates);
    this.applyModelConfig();
    this.ui.notice(`All roles set to ${selected.provider}/${selected.model}`);
  }

  private async fetchModelEntries(): Promise<Array<{ name: string; description: string; value: ModelEntry }> | null> {
    let providers;
    try {
      providers = await this.api.listProviders();
    } catch (err) {
      this.ui.log("error", "airgent", `Cannot list providers: ${sanitizeError(err)}`);
      return null;
    }

    const entries: Array<{ name: string; description: string; value: ModelEntry }> = [];
    const connectedSet = new Set(providers.connected);
    for (const p of providers.all) {
      if (!connectedSet.has(p.id)) continue;
      if (p.models) {
        for (const [id, info] of Object.entries(p.models)) {
          entries.push({
            name: `${p.id}/${id}`,
            description: info?.name ?? "",
            value: { provider: p.id, model: id },
          });
        }
      }
    }

    if (entries.length === 0) {
      this.ui.log("warn", "airgent", "No connected models found.");
      this.ui.log("warn", "airgent", "Run `opencode serve` then /connect in the OpenCode TUI to add models.");
      return null;
    }

    return entries;
  }

  private async handleModelCommand(args: string[]): Promise<void> {
    if (args[0] === "all") {
      await this.configureModelForAll();
    } else if (args[0] && ROLE_CONFIGS.some(r => r.key === args[0])) {
      await this.configureModelForRole(args[0] as ModelRole);
    } else {
      const m = this.config.models;
      for (const { key } of ROLE_CONFIGS) {
        this.ui.log("info", "model", `${key}: ${m[key].provider}/${m[key].model}`);
      }
      this.ui.log("info", "airgent", "Usage: /model <role> | all — roles: " + ROLE_CONFIGS.map(r => r.key).join(", "));
    }
  }

  private applyModelConfig(): void {
    const m = this.config.models;
    this.planner.switchModel(m.planner);
    this.worker.switchModel(m.generate);
    this.memoryOrganizer.switchModel(m.validation);
    this.compression.switchModel(m.compression);
    this.validation.switchModel(m.validation);
    this.watchdog.switchModel(m.watchdog);
    this.contextInspector.switchModel(m.validation);
  }

  private buildAgentContext(task: string): AgentContext {
    const { prompt } = this.promptManager.buildSystemPrompt();
    const memories = this.memory.findRelevant([task]);

    return {
      sessionId: this.sessionId!,
      messages: [{ id: randomUUID(), role: "user", content: task, timestamp: Date.now() }],
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

  private updateStatus(partial: Partial<StatusInfo>): void {
    this.ui.updateStatus(partial);
  }
}
