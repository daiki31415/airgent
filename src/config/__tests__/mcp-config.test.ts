import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { ConfigManager } from "../index";

const TEST_CONFIG_DIR = join(homedir(), ".config", "Airgent");

describe("ConfigManager MCP", () => {
	beforeAll(() => {
		mkdirSync(TEST_CONFIG_DIR, { recursive: true });
	});

	afterAll(() => {
		const mcpPath = join(TEST_CONFIG_DIR, "mcp.json");
		if (existsSync(mcpPath)) rmSync(mcpPath);
	});

	test("loadMCPServers returns empty array when no config exists", () => {
		const mcpPath = join(TEST_CONFIG_DIR, "mcp.json");
		if (existsSync(mcpPath)) rmSync(mcpPath);
		const cm = new ConfigManager();
		const servers = cm.loadMCPServers();
		expect(servers).toEqual([]);
	});

	test("loadMCPServers reads saved servers", () => {
		const cm = new ConfigManager();
		const testServers = [
			{
				name: "playwright",
				type: "local" as const,
				command: ["npx", "playwright"],
				enabled: true,
			},
		];
		cm.saveMCPServers(testServers);
		const loaded = cm.loadMCPServers();
		expect(loaded).toHaveLength(1);
		expect(loaded[0]?.name).toBe("playwright");
		expect(loaded[0]?.type).toBe("local");
		expect(loaded[0]?.command).toEqual(["npx", "playwright"]);
	});

	test("saveMCPServers persists to disk", () => {
		const cm = new ConfigManager();
		const servers = [
			{
				name: "s1",
				type: "local" as const,
				command: ["echo", "hi"],
				enabled: true,
			},
			{
				name: "s2",
				type: "remote" as const,
				url: "https://example.com/mcp",
				enabled: false,
			},
		];
		cm.saveMCPServers(servers);
		const raw = readFileSync(join(TEST_CONFIG_DIR, "mcp.json"), "utf-8");
		const parsed = JSON.parse(raw);
		expect(parsed.servers).toHaveLength(2);
		expect(parsed.servers[0].name).toBe("s1");
		expect(parsed.servers[1].url).toBe("https://example.com/mcp");
	});

	test("saveMCPServers overwrites existing file", () => {
		const cm = new ConfigManager();
		cm.saveMCPServers([{ name: "a", type: "local" as const, command: ["a"], enabled: true }]);
		cm.saveMCPServers([{ name: "b", type: "local" as const, command: ["b"], enabled: true }]);
		const loaded = cm.loadMCPServers();
		expect(loaded).toHaveLength(1);
		expect(loaded[0]?.name).toBe("b");
	});

	test("loadMCPServers handles malformed JSON gracefully", () => {
		const mcpPath = join(TEST_CONFIG_DIR, "mcp.json");
		writeFileSync(mcpPath, "not json", "utf-8");
		const cm = new ConfigManager();
		const servers = cm.loadMCPServers();
		expect(servers).toEqual([]);
	});

	test("loadMCPServers handles missing servers key", () => {
		const mcpPath = join(TEST_CONFIG_DIR, "mcp.json");
		writeFileSync(mcpPath, JSON.stringify({ not_servers: [] }), "utf-8");
		const cm = new ConfigManager();
		const servers = cm.loadMCPServers();
		expect(servers).toEqual([]);
	});
});
