import type { CompressionAgent } from "../agents/compression";
import type { ContextInspectorAgent } from "../agents/context-inspector";
import type { MemoryOrganizerAgent } from "../agents/memory-organizer";
import type { PlannerAgent } from "../agents/planner";
import type { ValidationAgent } from "../agents/validation";
import type { WatchdogAgent } from "../agents/watchdog";
import type { WorkerAgent } from "../agents/worker";
import type { OpenCodeAPI } from "../api/opencode";
import type { CompressionManager } from "../compression/index";
import type { ConfigManager } from "../config/index";
import type { PipelineEngine } from "../pipeline/index";
import type { DeviceSync } from "../sync/index";
import type {
	MCPServerConfig,
	ModelConfig,
	ModelEntry,
	Settings,
} from "../types";
import type { StatusInfo, UIManager } from "../ui/index";
import { sanitizeError } from "../utils/logger";
import { smartCat } from "../utils/smart-cat";

type ModelRole =
	| "planner"
	| "generate"
	| "compression"
	| "validation"
	| "watchdog";

const ROLE_CONFIGS: Array<{ key: ModelRole; label: string }> = [
	{ key: "planner", label: "Planner (task decomposition)" },
	{ key: "generate", label: "Generate (primary generation)" },
	{ key: "compression", label: "Compression (context compression)" },
	{ key: "validation", label: "Validation (quality check)" },
	{ key: "watchdog", label: "Watchdog (error detection)" },
];

export interface AgentHandle {
	configManager: ConfigManager;
	config: { models: ModelConfig; settings: Settings };
	api: OpenCodeAPI;
	ui: UIManager;
	compressionManager: CompressionManager;
	deviceSync: DeviceSync;
	pipeline: PipelineEngine;
	pipelineData: Record<string, string | undefined>;
	sessionId: string | null;
	_startTime: number;
	storage: any;

	planner: PlannerAgent;
	worker: WorkerAgent;
	memoryOrganizer: MemoryOrganizerAgent;
	compression: CompressionAgent;
	validation: ValidationAgent;
	watchdog: WatchdogAgent;
	contextInspector: ContextInspectorAgent;

	applyModelConfig(): void;
	configureModels(): Promise<void>;
	configureModelForRole(role: ModelRole): Promise<void>;
	configureModelForAll(): Promise<void>;
	processTask(task: string): Promise<void>;
	stop(): Promise<void>;
	updateStatus(partial: Partial<StatusInfo>): void;
}

export async function handleSettingCommand(agent: AgentHandle): Promise<void> {
	const category = await agent.ui.showSelectMenu("Settings", [
		{
			name: "Models",
			description: "Configure model per role",
			value: "models",
		},
		{
			name: "Providers",
			description: "Set API keys for providers",
			value: "providers",
		},
		{ name: "General", description: "Edit settings values", value: "general" },
		{
			name: "View Config",
			description: "Show current configuration",
			value: "view",
		},
	]);
	if (!category) return;

	switch (category) {
		case "models":
			await handleSettingModels(agent);
			break;
		case "providers":
			await handleSettingProviders(agent);
			break;
		case "general":
			await handleSettingGeneral(agent);
			break;
		case "view":
			handleSettingViewConfig(agent);
			break;
	}
}

async function handleSettingModels(agent: AgentHandle): Promise<void> {
	const roleOptions = [
		{
			name: "All roles",
			description: "Set one model for every role",
			value: "__all__",
		},
		...ROLE_CONFIGS.map((r) => ({
			name: r.label,
			description: "",
			value: r.key,
		})),
	];
	const selected = await agent.ui.showSelectMenu("Select Role", roleOptions);
	if (!selected) return;
	if (selected === "__all__") {
		await agent.configureModelForAll();
	} else {
		const role = ROLE_CONFIGS.find((r) => r.key === selected);
		if (role) {
			const entries = await fetchModelEntries(agent);
			if (!entries) return;
			const model = await agent.ui.selectModel(role.label, entries);
			if (model) {
				agent.configManager.saveModels({ [selected]: { ...model } });
				agent.applyModelConfig();
				agent.ui.notice(`Model for ${selected} updated`);
			}
		}
	}
}

async function handleSettingProviders(agent: AgentHandle): Promise<void> {
	try {
		const providers = await agent.api.listProviders();
		const connected = providers.connected;
		if (connected.length === 0) {
			agent.ui.log("warn", "settings", "No connected providers");
			return;
		}
		const options = connected.map((id) => {
			const info = providers.all.find((p) => p.id === id);
			return { name: id, description: info?.name || "", value: id };
		});
		const selected = await agent.ui.showSelectMenu("Set API Key", options);
		if (!selected) return;
		const apiKey = await agent.ui.prompt(`API key for ${selected}: `);
		if (!apiKey) return;
		await agent.api.setAuth(selected, apiKey);
		agent.ui.log("info", "settings", `API key set for ${selected}`);
	} catch (err) {
		agent.ui.log("error", "settings", sanitizeError(err));
	}
}

async function handleSettingGeneral(agent: AgentHandle): Promise<void> {
	const settings = agent.config.settings;
	const settingEntries = [
		{
			key: "maxSystemPromptTokens" as const,
			label: "Max system prompt tokens",
			type: "number" as const,
		},
		{
			key: "maxContextTokens" as const,
			label: "Max context tokens",
			type: "number" as const,
		},
		{
			key: "uiRefreshIntervalMs" as const,
			label: "UI refresh interval (ms)",
			type: "number" as const,
		},
		{
			key: "autoCompressThreshold" as const,
			label: "Auto-compress threshold",
			type: "number" as const,
		},
		{
			key: "watchdogIntervalMs" as const,
			label: "Watchdog interval (ms)",
			type: "number" as const,
		},
		{
			key: "maxRetriesPerNode" as const,
			label: "Max retries per node",
			type: "number" as const,
		},
		{
			key: "memoryAutoLink" as const,
			label: "Memory auto-link",
			type: "boolean" as const,
		},
		{
			key: "showPipelineProgress" as const,
			label: "Show pipeline progress",
			type: "boolean" as const,
		},
		{ key: "debug" as const, label: "Debug mode", type: "boolean" as const },
	];

	const options = settingEntries.map((e) => ({
		name: e.label,
		description: String(settings[e.key]),
		value: e,
	}));
	const raw = await agent.ui.showSelectMenu("Edit Setting", options);
	if (!raw) return;
	const sel = raw as {
		key: keyof Settings;
		label: string;
		type: "number" | "boolean";
	};

	let newValue: any;
	if (sel.type === "boolean") {
		const choice = await agent.ui.showSelectMenu(sel.label, [
			{ name: "true", description: "Enable", value: true },
			{ name: "false", description: "Disable", value: false },
		]);
		if (choice === null) return;
		newValue = choice;
	} else {
		const input = await agent.ui.prompt(
			`${sel.label} [${settings[sel.key]}]: `,
		);
		if (!input) return;
		if (sel.type === "number") {
			newValue =
				sel.key === "autoCompressThreshold"
					? parseFloat(input)
					: parseInt(input, 10);
			if (Number.isNaN(newValue)) {
				agent.ui.log("warn", "settings", "Invalid number");
				return;
			}
		} else {
			newValue = input;
		}
	}

	agent.configManager.saveSettings({ [sel.key]: newValue });
	agent.ui.log("info", "settings", `${sel.label} → ${newValue}`);
}

function handleSettingViewConfig(agent: AgentHandle): void {
	const m = agent.config.models;
	for (const { key, label } of ROLE_CONFIGS) {
		agent.ui.log(
			"info",
			"config",
			`${label}: ${m[key].provider}/${m[key].model}`,
		);
	}
	const s = agent.config.settings;
	agent.ui.log(
		"info",
		"config",
		`maxTokens: ${s.maxSystemPromptTokens} | context: ${s.maxContextTokens}`,
	);
	agent.ui.log(
		"info",
		"config",
		`debug: ${s.debug} | autoLink: ${s.memoryAutoLink} | progress: ${s.showPipelineProgress}`,
	);
	agent.ui.log(
		"info",
		"config",
		`retries: ${s.maxRetriesPerNode} | compress: ${s.autoCompressThreshold} | ui: ${s.uiRefreshIntervalMs}ms`,
	);
}

export async function handleModelCommand(
	agent: AgentHandle,
	args: string[],
): Promise<void> {
	if (args[0] === "all") {
		await agent.configureModelForAll();
	} else if (args[0] && ROLE_CONFIGS.some((r) => r.key === args[0])) {
		await agent.configureModelForRole(args[0] as ModelRole);
	} else {
		const m = agent.config.models;
		for (const { key } of ROLE_CONFIGS) {
			agent.ui.log(
				"info",
				"model",
				`${key}: ${m[key].provider}/${m[key].model}`,
			);
		}
		agent.ui.log(
			"info",
			"airgent",
			"Usage: /model <role> | all — roles: " +
				ROLE_CONFIGS.map((r) => r.key).join(", "),
		);
	}
}

export async function handleMCPCommand(
	agent: AgentHandle,
	args: string[],
	_line: string,
): Promise<void> {
	const sub = args[0];

	if (!sub || sub === "list") {
		try {
			const status = await agent.api.listMCP();
			const servers = agent.configManager.loadMCPServers();
			if (servers.length === 0) {
				agent.ui.log("info", "mcp", "No MCP servers configured");
			} else {
				for (const s of servers) {
					const st = status[s.name]?.status || "unknown";
					agent.ui.log(
						"info",
						"mcp",
						`${s.name} [${s.type}] ${st === "connected" ? "✓" : st}`,
					);
				}
			}
			agent.ui.log(
				"info",
				"mcp",
				"Usage: /mcp add <name> local <command...> | add-remote <name> <url> | connect <name> | disconnect <name> | remove <name>",
			);
		} catch (err) {
			agent.ui.log("error", "mcp", sanitizeError(err));
		}
		return;
	}

	if (sub === "add") {
		const name = args[1];
		const type = args[2];
		const restArgs = args.slice(3).filter((a): a is string => a !== undefined);
		if (!name || !type || restArgs.length === 0) {
			agent.ui.log(
				"warn",
				"mcp",
				"Usage: /mcp add <name> local <cmd> [arg...]",
			);
			return;
		}
		const servers = agent.configManager.loadMCPServers();
		if (servers.some((s) => s.name === name)) {
			agent.ui.log("warn", "mcp", `Server "${name}" already exists`);
			return;
		}
		const server: MCPServerConfig = {
			name,
			type: type as "local",
			command: restArgs,
			enabled: true,
		};
		servers.push(server);
		agent.configManager.saveMCPServers(servers);
		try {
			await agent.api.addMCP(name, {
				type: "local",
				command: restArgs,
				enabled: true,
			} as unknown as Record<string, unknown>);
			agent.ui.log("info", "mcp", `Added: ${name}`);
		} catch (err) {
			agent.ui.log("error", "mcp", sanitizeError(err));
		}
		return;
	}

	if (sub === "add-remote") {
		const name = args[1];
		const url = args[2];
		if (!name || !url) {
			agent.ui.log("warn", "mcp", "Usage: /mcp add-remote <name> <url>");
			return;
		}
		const servers = agent.configManager.loadMCPServers();
		if (servers.some((s) => s.name === name)) {
			agent.ui.log("warn", "mcp", `Server "${name}" already exists`);
			return;
		}
		const server: MCPServerConfig = {
			name,
			type: "remote",
			url,
			enabled: true,
		};
		servers.push(server);
		agent.configManager.saveMCPServers(servers);
		try {
			await agent.api.addMCP(name, {
				type: "remote",
				url,
				enabled: true,
			} as unknown as Record<string, unknown>);
			agent.ui.log("info", "mcp", `Added remote: ${name}`);
		} catch (err) {
			agent.ui.log("error", "mcp", sanitizeError(err));
		}
		return;
	}

	if (sub === "connect") {
		const name = args[1];
		if (!name) {
			agent.ui.log("warn", "mcp", "Usage: /mcp connect <name>");
			return;
		}
		try {
			await agent.api.connectMCP(name);
			agent.ui.log("info", "mcp", `Connected: ${name}`);
		} catch (err) {
			agent.ui.log("error", "mcp", sanitizeError(err));
		}
		return;
	}

	if (sub === "disconnect") {
		const name = args[1];
		if (!name) {
			agent.ui.log("warn", "mcp", "Usage: /mcp disconnect <name>");
			return;
		}
		try {
			await agent.api.disconnectMCP(name);
			agent.ui.log("info", "mcp", `Disconnected: ${name}`);
		} catch (err) {
			agent.ui.log("error", "mcp", sanitizeError(err));
		}
		return;
	}

	if (sub === "remove") {
		const name = args[1];
		if (!name) {
			agent.ui.log("warn", "mcp", "Usage: /mcp remove <name>");
			return;
		}
		const servers = agent.configManager
			.loadMCPServers()
			.filter((s) => s.name !== name);
		agent.configManager.saveMCPServers(servers);
		agent.ui.log("info", "mcp", `Removed: ${name}`);
		return;
	}

	agent.ui.log("warn", "mcp", `Unknown subcommand: ${sub}. See /mcp list`);
}

export async function handleInput(
	agent: AgentHandle,
	line: string,
): Promise<void> {
	agent.ui.log("info", "user", line);
	const lower = line.toLowerCase();

	if (lower.startsWith("/")) {
		const [cmd, ...args] = lower.split(/\s+/);
		switch (cmd) {
			case "/quit":
			case "/exit":
				await agent.stop();
				process.exit(0);
				return;
			case "/help":
				agent.ui.log(
					"info",
					"airgent",
					"/quit /model /mcp /setting /status /session /compress /providers /sync /cat /copy /help /info",
				);
				return;
			case "/info": {
				const health = await agent.api.healthCheck();
				agent.ui.notice(
					"Commands: /quit /help /status /info /session /compress /providers /sync /cat /copy",
				);
				agent.ui.notice("Airgent v1.0.0");
				agent.ui.notice(
					health.healthy
						? `OpenCode v${health.version || "?"} (connected)`
						: "OpenCode (not connected)",
				);
				return;
			}
			case "/status":
				agent.ui.log(
					"info",
					"airgent",
					`Uptime: ${Date.now() - agent._startTime}ms | Session: ${agent.sessionId || "none"}`,
				);
				return;
			case "/session":
				if (agent.sessionId) {
					const session = agent.storage.getSession(agent.sessionId);
					agent.ui.log("info", "airgent", JSON.stringify(session, null, 2));
				} else {
					agent.ui.log("info", "airgent", "No active session");
				}
				return;
			case "/model":
				await handleModelCommand(agent, args);
				return;
			case "/setting":
				await handleSettingCommand(agent);
				return;
			case "/compress":
				if (agent.sessionId)
					await agent.compressionManager.compressSession(agent.sessionId);
				agent.ui.log("info", "airgent", "Compression done");
				return;
			case "/providers":
				try {
					const providers = await agent.api.listProviders();
					agent.ui.log(
						"info",
						"providers",
						`Connected: ${providers.connected.join(", ")}`,
					);
					agent.ui.log(
						"info",
						"providers",
						`Available: ${providers.all.map((p) => p.id).join(", ")}`,
					);
				} catch (err) {
					agent.ui.log("error", "providers", sanitizeError(err));
				}
				return;
			case "/sync":
				if (args[0] === "push") {
					const url = args.slice(1).join(" ");
					if (url) agent.deviceSync.initGit(url);
					try {
						agent.deviceSync.push();
						agent.ui.log("info", "sync", "Push done");
					} catch (err) {
						agent.ui.log("error", "sync", sanitizeError(err));
					}
				} else if (args[0] === "pull") {
					try {
						agent.deviceSync.pull();
						agent.ui.log("info", "sync", "Pull done");
					} catch (err) {
						agent.ui.log("error", "sync", sanitizeError(err));
					}
				} else {
					agent.ui.log(
						"info",
						"sync",
						"Usage: /sync push <remote-url>  |  /sync pull",
					);
				}
				return;
			case "/cat":
				if (args[0]) {
					try {
						const content = smartCat(line.slice(5).trim());
						agent.ui.log("info", "cat", content.slice(0, 2000));
					} catch (err) {
						agent.ui.log("error", "cat", sanitizeError(err));
					}
				} else {
					agent.ui.log("info", "cat", "Usage: /cat <file>");
				}
				return;
			case "/copy": {
				const copyText =
					args.join(" ") ||
					agent.pipelineData.generatedOutput ||
					agent.pipelineData.plan ||
					"";
				if (!copyText) {
					agent.ui.log(
						"warn",
						"airgent",
						"Nothing to copy. Usage: /copy [text]",
					);
					return;
				}
				const result = agent.ui.copy(copyText);
				if (result.success) {
					agent.ui.log("info", "airgent", `Copied via ${result.method}`);
				} else {
					agent.ui.log("error", "airgent", `Copy failed: ${result.error}`);
				}
				return;
			}
			case "/mcp":
				await handleMCPCommand(agent, args, line);
				return;
		}
	}

	await agent.processTask(line);
}

async function fetchModelEntries(agent: AgentHandle): Promise<Array<{
	name: string;
	description: string;
	value: ModelEntry;
}> | null> {
	let providers;
	try {
		providers = await agent.api.listProviders();
	} catch (err) {
		agent.ui.log(
			"error",
			"airgent",
			`Cannot list providers: ${sanitizeError(err)}`,
		);
		return null;
	}

	const entries: Array<{
		name: string;
		description: string;
		value: ModelEntry;
	}> = [];
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
		agent.ui.log("warn", "airgent", "No connected models found.");
		agent.ui.log(
			"warn",
			"airgent",
			"Run `opencode serve` then /connect in the OpenCode TUI to add models.",
		);
		return null;
	}

	return entries;
}

export async function configureModels(agent: AgentHandle): Promise<void> {
	const entries = await fetchModelEntries(agent);
	if (!entries) return;

	agent.ui.log(
		"info",
		"airgent",
		"Model selection — choose a model for each role:",
	);
	const updates: Partial<ModelConfig> = {};
	for (const { key, label } of ROLE_CONFIGS) {
		const selected = await agent.ui.selectModel(label, entries);
		if (!selected) {
			agent.ui.log("warn", "airgent", `Skipped ${key}`);
			continue;
		}
		updates[key] = { ...selected };
	}

	if (Object.keys(updates).length > 0) {
		agent.configManager.saveModels({ ...updates, fallback: [] });
		agent.applyModelConfig();
		agent.ui.notice("Model configuration saved!");
		agent.ui.log(
			"info",
			"airgent",
			`Changed: ${Object.keys(updates).join(", ")}`,
		);
	}
}

export async function configureModelForRole(
	agent: AgentHandle,
	role: ModelRole,
): Promise<void> {
	const entries = await fetchModelEntries(agent);
	if (!entries) return;

	const cfg = ROLE_CONFIGS.find((r) => r.key === role)!;
	const selected = await agent.ui.selectModel(cfg.label, entries);
	if (!selected) {
		agent.ui.log("warn", "airgent", `Model selection for ${role} cancelled`);
		return;
	}

	const update = { [role]: { ...selected } };
	agent.configManager.saveModels(update);
	agent.applyModelConfig();
	agent.ui.notice(
		`Model for ${role} saved: ${selected.provider}/${selected.model}`,
	);
}

export async function configureModelForAll(agent: AgentHandle): Promise<void> {
	const entries = await fetchModelEntries(agent);
	if (!entries) return;

	const selected = await agent.ui.selectModel("Model for all roles", entries);
	if (!selected) {
		agent.ui.log("warn", "airgent", "Model selection cancelled");
		return;
	}

	const updates: Partial<ModelConfig> = {};
	for (const { key } of ROLE_CONFIGS) {
		updates[key] = { ...selected };
	}
	agent.configManager.saveModels(updates);
	agent.applyModelConfig();
	agent.ui.notice(`All roles set to ${selected.provider}/${selected.model}`);
}
