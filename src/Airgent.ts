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
import type { AgentContext, ModelConfig, ModelEntry, MCPServerConfig, Question, Settings } from "./types";
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
    onShutdown: () => this.stop(),
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
          this.ui.log("info", "airgent", "/quit /model /mcp /setting /status /session /compress /providers /sync /cat /copy /help /info");
          return;
        case "/info": {
          const health = await this.api.healthCheck();
          this.ui.notice("Commands: /quit /help /status /info /session /compress /providers /sync /cat /copy");
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
        case "/setting":
          await this.handleSettingCommand();
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
        case "/copy": {
          const copyText = args.join(" ") || this.pipelineData.generatedOutput || "";
          if (!copyText) {
            this.ui.log("warn", "airgent", "Nothing to copy. Usage: /copy [text]");
            return;
          }
          const result = this.ui.copy(copyText);
          if (result.success) {
            this.ui.log("info", "airgent", `Copied via ${result.method}`);
          } else {
            this.ui.log("error", "airgent", `Copy failed: ${result.error}`);
          }
          return;
        }
        case "/mcp":
          await this.handleMCPCommand(args, line);
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

  private extractQuestion(text: string): Question | null {
    const m = text.match(/\[QUESTION\]([\s\S]*?)\[\/QUESTION\]/);
    if (!m) return null;
    try {
      return JSON.parse(m[1].trim());
    } catch {
      return null;
    }
  }

  private async chatWithQuestion(
    model: ModelEntry,
    messages: Array<{ role: string; content: string }>,
  ): Promise<string> {
    for (let i = 0; i < 5; i++) {
      const response = await this.api.chat(model, messages);
      const q = this.extractQuestion(response.content);
      if (!q) return response.content;
      const clean = response.content.replace(/\[QUESTION\][\s\S]*?\[\/QUESTION\]/, "").trim();
      if (clean) {
        messages.push({ role: "assistant", content: clean });
      }
      const answer = await this.ui.askQuestion(q);
      messages.push({ role: "user", content: `[Your answer: ${answer}]` });
    }
    throw new Error("chatWithQuestion: too many question rounds");
  }

  private async streamNodeOutput(
    model: ModelEntry,
    messages: Array<{ role: string; content: string }>,
    nodeName: string,
    dstField: keyof typeof this.pipelineData
  ): Promise<string> {
    this.ui.stream(`  → ${nodeName}`);
    let buffer = "";
    let content = "";
    try {
      for await (const chunk of this.api.streamChat(model, messages)) {
        content += chunk;
        buffer += chunk;
        if (buffer.includes("\n")) {
          const lines = buffer.split("\n");
          for (let i = 0; i < lines.length - 1; i++) {
            const l = lines[i]!.trim();
            if (l) this.ui.stream(`    ${l}`);
          }
          buffer = lines[lines.length - 1]!;
        }
      }
      if (buffer.trim()) this.ui.stream(`    ${buffer.trim()}`);
    } catch {
      // fallback: non-streaming
      const res = await this.api.chat(model, messages);
      content = res.content;
      this.ui.stream(`    ${content.slice(0, 500)}...`);
    }
    this.pipelineData[dstField] = content;
    return content;
  }

  private registerPipelineHandlers(): void {
    this.pipeline.registerHandler("clarify", async () => {
      const messages = [
        { role: "system" as const, content: this.promptManager.buildNodePrompt("clarify") },
        { role: "user" as const, content: `Analyze this task:\n${this.currentTask}` },
      ];
      if (this.config.settings.showPipelineProgress) {
        this.ui.stream(`  → clarify input: ${this.currentTask.slice(0, 200)}`);
        const content = await this.streamNodeOutput(this.config.models.planner, messages, "clarify output", "clarifiedTask");
        return { content };
      }
      const content = await this.chatWithQuestion(this.config.models.planner, messages);
      this.pipelineData.clarifiedTask = content;
      this.ui.log("info", "clarify", `Analyzed task`);
      return { content };
    });

    this.pipeline.registerHandler("plan", async () => {
      const source = this.pipelineData.clarifiedTask || this.currentTask;
      const messages = [
        { role: "system" as const, content: `${this.promptManager.buildNodePrompt("plan")}` },
        { role: "user" as const, content: `Create a plan based on the requirements:\n\n${source}` },
      ];
      if (this.config.settings.showPipelineProgress) {
        this.ui.stream(`  → plan input: ${source.slice(0, 200)}`);
        const content = await this.streamNodeOutput(this.config.models.planner, messages, "plan output", "plan");
        return { content };
      }
      const content = await this.chatWithQuestion(this.config.models.planner, messages);
      this.pipelineData.plan = content;
      this.ui.log("info", "plan", `Created plan`);
      return { content };
    });

    this.pipeline.registerHandler("generate", async () => {
      const memories = this.memory.findRelevant([this.currentTask]).slice(0, 3);
      const memoryStr = memories.map(m => `- ${m.bug}: ${m.fix}`).join("\n");
      const parts = [
        memoryStr ? `Relevant context:\n${memoryStr}` : "",
        this.pipelineData.plan ? `Approach:\n${this.pipelineData.plan}` : "",
        this.pipelineData.clarifiedTask ? `Requirements:\n${this.pipelineData.clarifiedTask}` : "",
        `Task: ${this.currentTask}`,
      ].filter(Boolean);
      const generationPrompt = parts.join("\n\n");
      if (this.config.settings.showPipelineProgress) {
        this.ui.stream(`  → generate input: ${generationPrompt.slice(0, 300)}`);
        this.ui.stream(`  → generate output:`);
        const result = await this.worker.execute(generationPrompt, (chunk: string) => {
          const lines = chunk.split("\n");
          for (const l of lines) {
            const trimmed = l.trim();
            if (trimmed) this.ui.stream(`    ${trimmed}`);
          }
        });
        this.pipelineData.generatedOutput = result.content;
        return result;
      }
      const result = await this.worker.execute(generationPrompt);
      this.pipelineData.generatedOutput = result.content;
      this.ui.log("info", "generate", `Generated: ${result.content.length} chars`);
      return result;
    });

    this.pipeline.registerHandler("test", async () => {
      if (!this.pipelineData.generatedOutput) return { status: "skipped", reason: "no output" };
      const messages = [
        { role: "system" as const, content: this.promptManager.buildNodePrompt("test") },
        { role: "user" as const, content: `Task: ${this.currentTask}\n\nOutput:\n${this.pipelineData.generatedOutput.slice(0, 4000)}` },
      ];
      if (this.config.settings.showPipelineProgress) {
        this.ui.stream(`  → test input: ${this.pipelineData.generatedOutput.slice(0, 200)}`);
        const content = await this.streamNodeOutput(this.config.models.validation, messages, "test result", "testResult");
        const hasIssues = /(?:bug|error|issue|incorrect|wrong|missing)/i.test(content);
        this.ui.stream(`  → test ${hasIssues ? "⚠ issues found" : "✓ passed"}`);
        return { content, passed: !hasIssues };
      }
      const content = await this.chatWithQuestion(this.config.models.validation, messages);
      this.pipelineData.testResult = content;
      const hasIssues = /(?:bug|error|issue|incorrect|wrong|missing)/i.test(content);
      this.ui.log("info", "test", hasIssues ? `Issues found` : "No issues detected");
      return { content, passed: !hasIssues };
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

  private async handleSettingCommand(): Promise<void> {
    const category = await this.ui.showSelectMenu("Settings", [
      { name: "Models", description: "Configure model per role", value: "models" },
      { name: "Providers", description: "Set API keys for providers", value: "providers" },
      { name: "General", description: "Edit settings values", value: "general" },
      { name: "View Config", description: "Show current configuration", value: "view" },
    ]);
    if (!category) return;

    switch (category) {
      case "models":
        await this.handleSettingModels();
        break;
      case "providers":
        await this.handleSettingProviders();
        break;
      case "general":
        await this.handleSettingGeneral();
        break;
      case "view":
        this.handleSettingViewConfig();
        break;
    }
  }

  private async handleSettingModels(): Promise<void> {
    const roleOptions = [
      { name: "All roles", description: "Set one model for every role", value: "__all__" },
      ...ROLE_CONFIGS.map(r => ({ name: r.label, description: "", value: r.key })),
    ];
    const selected = await this.ui.showSelectMenu("Select Role", roleOptions);
    if (!selected) return;
    if (selected === "__all__") {
      await this.configureModelForAll();
    } else {
      const role = ROLE_CONFIGS.find(r => r.key === selected);
      if (role) {
        const entries = await this.fetchModelEntries();
        if (!entries) return;
        const model = await this.ui.selectModel(role.label, entries);
        if (model) {
          this.configManager.saveModels({ [selected]: { ...model } });
          this.applyModelConfig();
          this.ui.notice(`Model for ${selected} updated`);
        }
      }
    }
  }

  private async handleSettingProviders(): Promise<void> {
    try {
      const providers = await this.api.listProviders();
      const connected = providers.connected;
      if (connected.length === 0) {
        this.ui.log("warn", "settings", "No connected providers");
        return;
      }
      const options = connected.map(id => {
        const info = providers.all.find(p => p.id === id);
        return { name: id, description: info?.name || "", value: id };
      });
      const selected = await this.ui.showSelectMenu("Set API Key", options);
      if (!selected) return;
      const apiKey = await this.ui.prompt(`API key for ${selected}: `);
      if (!apiKey) return;
      await this.api.setAuth(selected, apiKey);
      this.ui.log("info", "settings", `API key set for ${selected}`);
    } catch (err) {
      this.ui.log("error", "settings", sanitizeError(err));
    }
  }

  private async handleSettingGeneral(): Promise<void> {
    const settings = this.config.settings;
    const settingEntries = [
      { key: "maxSystemPromptTokens" as const, label: "Max system prompt tokens", type: "number" as const },
      { key: "maxContextTokens" as const, label: "Max context tokens", type: "number" as const },
      { key: "uiRefreshIntervalMs" as const, label: "UI refresh interval (ms)", type: "number" as const },
      { key: "autoCompressThreshold" as const, label: "Auto-compress threshold", type: "number" as const },
      { key: "watchdogIntervalMs" as const, label: "Watchdog interval (ms)", type: "number" as const },
      { key: "maxRetriesPerNode" as const, label: "Max retries per node", type: "number" as const },
      { key: "memoryAutoLink" as const, label: "Memory auto-link", type: "boolean" as const },
      { key: "showPipelineProgress" as const, label: "Show pipeline progress", type: "boolean" as const },
      { key: "debug" as const, label: "Debug mode", type: "boolean" as const },
    ];

    const options = settingEntries.map(e => ({
      name: e.label,
      description: String(settings[e.key]),
      value: e,
    }));
    const raw = await this.ui.showSelectMenu("Edit Setting", options);
    if (!raw) return;
    const sel = raw as { key: keyof Settings; label: string; type: "number" | "boolean" };

    let newValue: any;
    if (sel.type === "boolean") {
      const choice = await this.ui.showSelectMenu(sel.label, [
        { name: "true", description: "Enable", value: true },
        { name: "false", description: "Disable", value: false },
      ]);
      if (choice === null) return;
      newValue = choice;
    } else {
      const input = await this.ui.prompt(`${sel.label} [${settings[sel.key]}]: `);
      if (!input) return;
      if (sel.type === "number") {
        newValue = sel.key === "autoCompressThreshold" ? parseFloat(input) : parseInt(input, 10);
        if (isNaN(newValue)) {
          this.ui.log("warn", "settings", "Invalid number");
          return;
        }
      } else {
        newValue = input;
      }
    }

    this.configManager.saveSettings({ [sel.key]: newValue });
    this.ui.log("info", "settings", `${sel.label} → ${newValue}`);
  }

  private handleSettingViewConfig(): void {
    const m = this.config.models;
    for (const { key, label } of ROLE_CONFIGS) {
      this.ui.log("info", "config", `${label}: ${m[key].provider}/${m[key].model}`);
    }
    const s = this.config.settings;
    this.ui.log("info", "config", `maxTokens: ${s.maxSystemPromptTokens} | context: ${s.maxContextTokens}`);
    this.ui.log("info", "config", `debug: ${s.debug} | autoLink: ${s.memoryAutoLink} | progress: ${s.showPipelineProgress}`);
    this.ui.log("info", "config", `retries: ${s.maxRetriesPerNode} | compress: ${s.autoCompressThreshold} | ui: ${s.uiRefreshIntervalMs}ms`);
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

  private async handleMCPCommand(args: string[], line: string): Promise<void> {
    const sub = args[0];

    if (!sub || sub === "list") {
      try {
        const status = await this.api.listMCP();
        const servers = this.configManager.loadMCPServers();
        if (servers.length === 0) {
          this.ui.log("info", "mcp", "No MCP servers configured");
        } else {
          for (const s of servers) {
            const st = status[s.name]?.status || "unknown";
            this.ui.log("info", "mcp", `${s.name} [${s.type}] ${st === "connected" ? "✓" : st}`);
          }
        }
        this.ui.log("info", "mcp", "Usage: /mcp add <name> local <command...> | add-remote <name> <url> | connect <name> | disconnect <name> | remove <name>");
      } catch (err) { this.ui.log("error", "mcp", sanitizeError(err)); }
      return;
    }

    if (sub === "add") {
      const name = args[1];
      const type = args[2];
      const restArgs = args.slice(3).filter((a): a is string => a !== undefined);
      if (!name || !type || restArgs.length === 0) {
        this.ui.log("warn", "mcp", "Usage: /mcp add <name> local <cmd> [arg...]");
        return;
      }
      const servers = this.configManager.loadMCPServers();
      if (servers.some(s => s.name === name)) {
        this.ui.log("warn", "mcp", `Server "${name}" already exists`);
        return;
      }
      const server: MCPServerConfig = {
        name, type: type as "local",
        command: restArgs,
        enabled: true,
      };
      servers.push(server);
      this.configManager.saveMCPServers(servers);
      try {
        await this.api.addMCP(name, { type: "local", command: restArgs, enabled: true } as unknown as Record<string, unknown>);
        this.ui.log("info", "mcp", `Added: ${name}`);
      } catch (err) { this.ui.log("error", "mcp", sanitizeError(err)); }
      return;
    }

    if (sub === "add-remote") {
      const name = args[1];
      const url = args[2];
      if (!name || !url) {
        this.ui.log("warn", "mcp", "Usage: /mcp add-remote <name> <url>");
        return;
      }
      const servers = this.configManager.loadMCPServers();
      if (servers.some(s => s.name === name)) {
        this.ui.log("warn", "mcp", `Server "${name}" already exists`);
        return;
      }
      const server: MCPServerConfig = {
        name, type: "remote", url, enabled: true,
      };
      servers.push(server);
      this.configManager.saveMCPServers(servers);
      try {
        await this.api.addMCP(name, { type: "remote", url, enabled: true } as unknown as Record<string, unknown>);
        this.ui.log("info", "mcp", `Added remote: ${name}`);
      } catch (err) { this.ui.log("error", "mcp", sanitizeError(err)); }
      return;
    }

    if (sub === "connect") {
      const name = args[1];
      if (!name) { this.ui.log("warn", "mcp", "Usage: /mcp connect <name>"); return; }
      try {
        await this.api.connectMCP(name);
        this.ui.log("info", "mcp", `Connected: ${name}`);
      } catch (err) { this.ui.log("error", "mcp", sanitizeError(err)); }
      return;
    }

    if (sub === "disconnect") {
      const name = args[1];
      if (!name) { this.ui.log("warn", "mcp", "Usage: /mcp disconnect <name>"); return; }
      try {
        await this.api.disconnectMCP(name);
        this.ui.log("info", "mcp", `Disconnected: ${name}`);
      } catch (err) { this.ui.log("error", "mcp", sanitizeError(err)); }
      return;
    }

    if (sub === "remove") {
      const name = args[1];
      if (!name) { this.ui.log("warn", "mcp", "Usage: /mcp remove <name>"); return; }
      const servers = this.configManager.loadMCPServers().filter(s => s.name !== name);
      this.configManager.saveMCPServers(servers);
      this.ui.log("info", "mcp", `Removed: ${name}`);
      return;
    }

    this.ui.log("warn", "mcp", `Unknown subcommand: ${sub}. See /mcp list`);
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
