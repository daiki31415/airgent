/**
 * Config Manager
 *
 * Loads Airgent configuration from ~/.config/Airgent/
 * Auto-creates defaults on first run.
 */

import * as fs from "node:fs";
import { homedir } from "node:os";
import * as path from "node:path";
import type {
	AirgentConfig,
	Constitution,
	MCPServerConfig,
	ModelConfig,
	Persona,
	Settings,
} from "../types";
import { rootLogger, sanitizeError } from "../utils/logger";

const DEFAULT_CONFIG_DIR = path.join(homedir(), ".config", "Airgent");

const DEFAULT_CONSTITUTION = `---
name: Airgent Constitution
version: 1.0.0
---

# Principles
- Robustness over smartness

# Constraints
- Never delete data without confirmation

# Ethical Guidelines
- Be helpful and harmless
`;

const DEFAULT_PERSONA = `---
name: Airgent Assistant
role: AI pair programmer
tone: professional
---

- Always explain your reasoning
- Ask for clarification when uncertain
`;

const DEFAULT_MODELS: ModelConfig = {
	planner: { provider: "", model: "" },
	generate: { provider: "", model: "" },
	compression: { provider: "", model: "" },
	validation: { provider: "", model: "" },
	watchdog: { provider: "", model: "" },
	fallback: [],
};

const DEFAULT_SETTINGS: Settings = {
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

export class ConfigManager {
	private logger = rootLogger.child("config");
	private cache: AirgentConfig | null = null;
	private configDir: string;
	firstRun = false;

	constructor(options?: { configDir?: string }) {
		this.configDir = options?.configDir ?? DEFAULT_CONFIG_DIR;
	}

	load(): AirgentConfig {
		if (this.cache) return this.cache;

		fs.mkdirSync(this.configDir, { recursive: true });

		const config: AirgentConfig = {
			constitution: this.loadConstitution(),
			persona: this.loadPersona(),
			models: this.loadModels(),
			settings: this.loadSettings(),
		};

		this.cache = config;
		this.logger.info("Configuration loaded");
		return config;
	}

	private loadConstitution(): Constitution {
		const filePath = path.join(this.configDir, "constitution.md");
		const raw = this.readOrCreate(filePath, DEFAULT_CONSTITUTION);
		return {
			name: this.extractFrontmatter(raw, "name") || "Airgent",
			version: this.extractFrontmatter(raw, "version") || "1.0.0",
			principles: this.extractList(raw, "Principles"),
			constraints: this.extractList(raw, "Constraints"),
			ethical_guidelines: this.extractList(raw, "Ethical Guidelines"),
		};
	}

	private loadPersona(): Persona {
		const filePath = path.join(this.configDir, "persona.md");
		const raw = this.readOrCreate(filePath, DEFAULT_PERSONA);
		return {
			name: this.extractFrontmatter(raw, "name") || "Assistant",
			role: this.extractFrontmatter(raw, "role") || "assistant",
			tone: this.extractFrontmatter(raw, "tone") || "professional",
			rules: this.extractList(raw, "persona"),
		};
	}

	private loadModels(): ModelConfig {
		const filePath = path.join(this.configDir, "models.json");
		const raw = this.readOrCreate(
			filePath,
			JSON.stringify(DEFAULT_MODELS, null, 2),
		);
		try {
			return JSON.parse(raw);
		} catch {
			this.logger.warn("Invalid models.json, using defaults");
			return DEFAULT_MODELS;
		}
	}

	private loadSettings(): Settings {
		const filePath = path.join(this.configDir, "settings.json");
		const raw = this.readOrCreate(
			filePath,
			JSON.stringify(DEFAULT_SETTINGS, null, 2),
		);
		try {
			return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
		} catch {
			this.logger.warn("Invalid settings.json, using defaults");
			return DEFAULT_SETTINGS;
		}
	}

	needsConfig(): boolean {
		const m = this.cache?.models;
		return (
			!m.planner.provider ||
			!m.planner.model ||
			!m.generate.provider ||
			!m.generate.model ||
			!m.compression.provider ||
			!m.compression.model ||
			!m.validation.provider ||
			!m.validation.model ||
			!m.watchdog.provider ||
			!m.watchdog.model
		);
	}

	saveSettings(partial: Partial<Settings>): void {
		const filePath = path.join(this.configDir, "settings.json");
		const updated = { ...this.cache?.settings, ...partial };
		this.cache!.settings = updated;
		fs.writeFileSync(filePath, JSON.stringify(updated, null, 2), {
			mode: 0o600,
			encoding: "utf-8",
		});
		this.logger.info("Settings saved");
	}

	saveModels(models: Partial<ModelConfig>): void {
		const filePath = path.join(this.configDir, "models.json");
		const updated = { ...this.cache?.models, ...models };

		// Strip apiKey before persisting to disk
		const serialized = structuredClone(updated) as Record<string, unknown>;
		for (const [_key, val] of Object.entries(serialized)) {
			if (typeof val === "object" && val !== null && "apiKey" in val) {
				const entry = val as Record<string, unknown>;
				delete entry.apiKey;
			}
		}

		this.cache!.models = updated as ModelConfig;
		fs.writeFileSync(filePath, JSON.stringify(serialized, null, 2), {
			mode: 0o600,
			encoding: "utf-8",
		});
		this.logger.info("Models saved");
	}

	getModels(): ModelConfig {
		return { ...this.cache?.models };
	}

	// ---- MCP ----

	loadMCPServers(): MCPServerConfig[] {
		const filePath = path.join(this.configDir, "mcp.json");
		const raw = this.readOrCreate(
			filePath,
			JSON.stringify({ servers: [] }, null, 2),
		);
		try {
			const data = JSON.parse(raw);
			return data.servers || [];
		} catch {
			this.logger.warn("Invalid mcp.json, using empty config");
			return [];
		}
	}

	saveMCPServers(servers: MCPServerConfig[]): void {
		const filePath = path.join(this.configDir, "mcp.json");
		fs.writeFileSync(filePath, JSON.stringify({ servers }, null, 2), {
			mode: 0o600,
			encoding: "utf-8",
		});
		this.logger.info("MCP servers saved");
	}

	private readOrCreate(filePath: string, defaultContent: string): string {
		try {
			if (fs.existsSync(filePath)) {
				return fs.readFileSync(filePath, "utf-8");
			}
			fs.writeFileSync(filePath, defaultContent, {
				mode: 0o600,
				encoding: "utf-8",
			});
			this.firstRun = true;
			this.logger.info(`Created default config: ${filePath}`);
			return defaultContent;
		} catch (err) {
			this.logger.warn(`Config error: ${sanitizeError(err)}`);
			return defaultContent;
		}
	}

	private extractFrontmatter(content: string, key: string): string | null {
		const match = content.match(new RegExp(`^${key}:\\s*(.+)$`, "m"));
		return match ? match[1]?.trim() : null;
	}

	private extractList(content: string, section: string): string[] {
		const regex = new RegExp(`#\\s*${section}\\s*\\n([\\s\\S]*?)(?:\\n#\\s|$)`);
		const match = content.match(regex);
		if (!match) return [];
		return match[1]
			?.split("\n")
			.map((l) => l.replace(/^-\s*/, "").trim())
			.filter(Boolean);
	}
}
