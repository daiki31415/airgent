/**
 * Slash command registry: the single list of commands a user can type.
 *
 * handleInput() switches on CommandName, so adding an entry here without
 * handling it there is a compile error. /help and /info are generated from
 * this list, so they cannot drift from the commands that actually exist.
 */

export interface CommandSpec {
	/** Canonical name, including the leading slash. */
	readonly name: string;
	readonly description: string;
	readonly usage?: string;
	/** Other names that run the same command. */
	readonly aliases?: readonly string[];
}

export const COMMANDS = [
	{ name: "/help", description: "List available commands" },
	{ name: "/info", description: "Show version and OpenCode connection status" },
	{ name: "/status", description: "Show uptime and the current session" },
	{ name: "/session", description: "Show details of the active session" },
	{
		name: "/model",
		description: "Show or change the model for a role",
		usage: "/model [<role>|all]",
	},
	{ name: "/setting", description: "Edit models, providers and general settings" },
	{
		name: "/mcp",
		description: "Manage MCP servers",
		usage: "/mcp [list|add|add-remote|connect|disconnect|remove] ...",
	},
	{ name: "/compress", description: "Compress the current session" },
	{ name: "/providers", description: "List connected and available providers" },
	{
		name: "/sync",
		description: "Sync memory with a git remote",
		usage: "/sync push <remote-url> | /sync pull",
	},
	{ name: "/cat", description: "Print a file", usage: "/cat <file>" },
	{
		name: "/copy",
		description: "Copy text, or the last output, to the clipboard",
		usage: "/copy [text]",
	},
	{ name: "/quit", description: "Quit Airgent", aliases: ["/exit"] },
] as const satisfies readonly CommandSpec[];

export type CommandName = (typeof COMMANDS)[number]["name"];

/** The same list typed as CommandSpec, so optional fields can be read without narrowing. */
export const COMMAND_SPECS: readonly CommandSpec[] = COMMANDS;

/** Resolve a typed command (any letter case) to its canonical name, or null if unknown. */
export function resolveCommand(input: string): CommandName | null {
	const typed = input.toLowerCase();
	const spec = COMMAND_SPECS.find((s) => s.name === typed || s.aliases?.includes(typed));
	return spec ? (spec.name as CommandName) : null;
}

/** Space-separated command names, for one-line summaries such as /info. */
export function commandNames(): string {
	return COMMAND_SPECS.map((s) => s.name).join(" ");
}

/**
 * Lines for /help: "name[, alias]  description", with the usage on an indented
 * line below when a command has one. The name column is sized to the names only,
 * so one long usage string does not push every description off to the right.
 */
export function formatHelp(): string[] {
	const labels = COMMAND_SPECS.map((s) => [s.name, ...(s.aliases ?? [])].join(", "));
	const width = Math.max(...labels.map((l) => l.length));
	const indent = " ".repeat(width + 2);
	return COMMAND_SPECS.flatMap((s, i) => {
		const lines = [`${(labels[i] ?? s.name).padEnd(width)}  ${s.description}`];
		if (s.usage) lines.push(`${indent}usage: ${s.usage}`);
		return lines;
	});
}

/**
 * True if the first word of an input looks like a slash command ("/help", "/hepl").
 * Words with a second slash ("/etc/hosts") are file paths in a normal request, not commands.
 */
export function isCommandLike(word: string): boolean {
	return /^\/[A-Za-z][A-Za-z0-9-]*$/.test(word);
}

const MAX_GUESSES = 3;

/** Damerau-Levenshtein distance (optimal string alignment): swapping two adjacent letters costs 1. */
function editDistance(a: string, b: string): number {
	const width = b.length + 1;
	const d = new Array<number>((a.length + 1) * width).fill(0);
	const at = (i: number, j: number): number => d[i * width + j] ?? 0;
	for (let i = 0; i <= a.length; i++) d[i * width] = i;
	for (let j = 0; j <= b.length; j++) d[j] = j;
	for (let i = 1; i <= a.length; i++) {
		for (let j = 1; j <= b.length; j++) {
			const cost = a[i - 1] === b[j - 1] ? 0 : 1;
			let best = Math.min(at(i - 1, j) + 1, at(i, j - 1) + 1, at(i - 1, j - 1) + cost);
			if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
				best = Math.min(best, at(i - 2, j - 2) + 1);
			}
			d[i * width + j] = best;
		}
	}
	return at(a.length, b.length);
}

/**
 * Best guesses for a mistyped command, most likely first; empty if nothing is close.
 * A prefix ("/mod") wins over a typo ("/hepl"). Otherwise the names nearest by
 * edit distance are returned, within a small tolerance.
 */
export function suggestCommands(input: string, limit = MAX_GUESSES): CommandSpec[] {
	const typed = input.toLowerCase();
	if (!typed.startsWith("/")) return [];
	const namesOf = (s: CommandSpec): string[] => [s.name, ...(s.aliases ?? [])];

	if (typed.length > 1) {
		const prefixed = COMMAND_SPECS.filter((s) => namesOf(s).some((n) => n.startsWith(typed)));
		if (prefixed.length > 0) return prefixed.slice(0, limit);
	}

	const tolerance = typed.length <= 4 ? 1 : 2;
	const scored = COMMAND_SPECS.map((spec) => ({
		spec,
		distance: Math.min(...namesOf(spec).map((n) => editDistance(typed, n))),
	})).filter((x) => x.distance <= tolerance);
	const best = Math.min(...scored.map((x) => x.distance));
	return scored
		.filter((x) => x.distance === best)
		.slice(0, limit)
		.map((x) => x.spec);
}

/** Warning for an unknown /command, with the single closest known command as a guess. */
export function unknownCommandMessage(typed: string): string {
	const guess = suggestCommands(typed, 1)[0];
	if (!guess) {
		return `Unknown command: ${typed}. Type /help to list commands.`;
	}
	return `Unknown command: ${typed}. Did you mean ${guess.name}? Type /help to list commands.`;
}
