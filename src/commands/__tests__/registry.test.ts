import { describe, expect, test } from "bun:test";
import {
	COMMAND_SPECS,
	commandNames,
	formatHelp,
	isCommandLike,
	resolveCommand,
	suggestCommands,
	unknownCommandMessage,
} from "../registry";

describe("COMMANDS", () => {
	test("every name and alias starts with a slash and none is used twice", () => {
		const all = COMMAND_SPECS.flatMap((s) => [s.name, ...(s.aliases ?? [])]);
		for (const n of all) expect(n.startsWith("/")).toBe(true);
		expect(new Set(all).size).toBe(all.length);
	});

	test("every command name is recognised as command-like", () => {
		for (const s of COMMAND_SPECS) expect(isCommandLike(s.name)).toBe(true);
	});
});

describe("resolveCommand", () => {
	test("resolves a name in any letter case", () => {
		expect(resolveCommand("/help")).toBe("/help");
		expect(resolveCommand("/HELP")).toBe("/help");
	});

	test("resolves an alias to its canonical name", () => {
		expect(resolveCommand("/exit")).toBe("/quit");
	});

	test("returns null for an unknown command", () => {
		expect(resolveCommand("/nope")).toBeNull();
	});
});

describe("isCommandLike", () => {
	test("accepts a single slash word, typo or not", () => {
		for (const w of ["/help", "/hepl", "/add-remote", "/MODEL"]) {
			expect(isCommandLike(w)).toBe(true);
		}
	});

	test("rejects file paths and other text", () => {
		for (const w of ["/etc/hosts", "/", "/9abc", "help", "", "/he lp"]) {
			expect(isCommandLike(w)).toBe(false);
		}
	});
});

describe("suggestCommands", () => {
	test("guesses the command for a swapped-letter typo", () => {
		expect(suggestCommands("/hepl")[0]?.name).toBe("/help");
		expect(suggestCommands("/stauts")[0]?.name).toBe("/status");
	});

	test("prefers a prefix match", () => {
		expect(suggestCommands("/mod")[0]?.name).toBe("/model");
	});

	test("returns nothing when nothing is close", () => {
		expect(suggestCommands("/zzzzzzzz")).toEqual([]);
	});

	test("returns nothing without a leading slash", () => {
		expect(suggestCommands("hepl")).toEqual([]);
	});

	test("honors the limit", () => {
		expect(suggestCommands("/s", 2).length).toBeLessThanOrEqual(2);
	});
});

describe("unknownCommandMessage", () => {
	test("guesses one closest command", () => {
		const msg = unknownCommandMessage("/hepl");

		expect(msg).toContain("Unknown command: /hepl");
		expect(msg).toContain("Did you mean /help?");
		expect(msg.split("Did you mean").length).toBe(2);
	});

	test("only points to /help when nothing is close", () => {
		const msg = unknownCommandMessage("/zzzzzzzz");

		expect(msg).toContain("Type /help");
		expect(msg).not.toContain("Did you mean");
	});
});

describe("formatHelp", () => {
	test("has a line for every command with its description", () => {
		const lines = formatHelp();
		for (const s of COMMAND_SPECS) {
			expect(lines.some((l) => l.startsWith(s.name) && l.includes(s.description))).toBe(true);
		}
	});

	test("shows an alias next to its command", () => {
		expect(formatHelp().some((l) => l.startsWith("/quit, /exit"))).toBe(true);
	});

	test("puts a usage on its own line below the command", () => {
		const lines = formatHelp();
		for (const s of COMMAND_SPECS) {
			if (!s.usage) continue;
			const at = lines.findIndex((l) => l.includes(s.description));
			expect(lines[at + 1]).toContain(s.usage);
		}
	});

	test("one long usage does not push the descriptions to the right", () => {
		const lines = formatHelp();
		const columns = COMMAND_SPECS.map((s) => {
			const line = lines.find((l) => l.includes(s.description)) ?? "";
			return line.indexOf(s.description);
		});

		expect(new Set(columns).size).toBe(1);
		expect(columns[0]).toBeLessThan(20);
	});
});

describe("commandNames", () => {
	test("lists the names in registry order", () => {
		expect(commandNames().split(" ")).toEqual(COMMAND_SPECS.map((s) => s.name));
	});
});
