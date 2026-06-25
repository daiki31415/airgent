import type { OpenCodeAPI } from "../api/opencode";
import type { ConfigManager } from "../config/index";
import type { UIManager } from "../ui/index";
import { sanitizeError } from "../utils/logger";

export interface ServerHandle {
	api: OpenCodeAPI;
	ui: UIManager;
	configManager: ConfigManager;
	opencodeProcess: import("bun").Subprocess | null;
	configureModels(): Promise<void>;
}

export async function ensureOpenCodeServer(agent: ServerHandle): Promise<void> {
	let health = await agent.api.healthCheck();
	if (!health.healthy) {
		agent.ui.log("info", "airgent", "Starting OpenCode server...");
		const SAFE_ENV_KEYS = [
			"HOME",
			"PATH",
			"USER",
			"SHELL",
			"TERM",
			"LANG",
			"OPENCODE_SERVER_PASSWORD",
			"OPENCODE_SERVER_USERNAME",
			"OPENCODE_BASE_URL",
			"NODE_ENV",
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
			agent.opencodeProcess = proc;

			const decoder = new TextDecoder();
			(async () => {
				const reader = proc.stdout.getReader();
				while (true) {
					const { done, value } = await reader.read();
					if (done) break;
					for (const line of decoder.decode(value).split("\n").filter(Boolean)) {
						agent.ui.log("info", "opencode", line);
					}
				}
			})();
			(async () => {
				const reader = proc.stderr.getReader();
				while (true) {
					const { done, value } = await reader.read();
					if (done) break;
					for (const line of decoder.decode(value).split("\n").filter(Boolean)) {
						agent.ui.log("error", "opencode", line);
					}
				}
			})();

			for (let i = 0; i < 30; i++) {
				await new Promise((r) => setTimeout(r, 500));
				if (i % 5 === 0 && agent.opencodeProcess) {
					agent.ui.log("info", "airgent", `Waiting for opencode server... (${(i + 1) * 0.5}s)`);
				}
				health = await agent.api.healthCheck();
				if (health.healthy) break;
			}
		} catch (err) {
			agent.ui.log("error", "airgent", `Failed to start OpenCode server: ${sanitizeError(err)}`);
		}
	}

	if (health.healthy) {
		agent.ui.log(
			"info",
			"airgent",
			"OpenCode server connected" + (health.version ? ` v${health.version}` : ""),
		);
	} else {
		agent.ui.log(
			"warn",
			"airgent",
			"OpenCode server not reachable. Set OPENCODE_SERVER_PASSWORD and run: opencode serve",
		);
	}

	if (health.healthy && agent.configManager.needsConfig()) {
		await agent.configureModels();
	}
}
