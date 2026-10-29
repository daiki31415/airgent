import { describe, expect, test } from "bun:test";
import { calledWith, spy, strContaining, wasCalled } from "../../__tests__/spy-utils";
import type { AgentHandle } from "../index";
import { handleInput } from "../index";
import { COMMAND_SPECS } from "../registry";

type CallLog = { calls: unknown[][] };

function createAgent() {
	const ui = {
		log: spy<unknown[], unknown>(),
		notice: spy<unknown[], unknown>(),
		copy: spy<unknown[], unknown>(() => ({ success: true, method: "clipboard" })),
	};
	const deviceSync = {
		initGit: spy<unknown[], unknown>(),
		push: spy<unknown[], unknown>(),
		pull: spy<unknown[], unknown>(),
	};
	const fake = {
		ui,
		deviceSync,
		pipelineData: {},
		processTask: spy<unknown[], unknown>(async () => {}),
		configureModelForAll: spy<unknown[], unknown>(async () => {}),
		configureModelForRole: spy<unknown[], unknown>(async () => {}),
	};
	return { agent: fake as unknown as AgentHandle, fake };
}

/** The message text of every ui.log(level, source, message) call. */
function logged(log: CallLog): string[] {
	return log.calls.map((c) => String(c[2]));
}

describe("handleInput: unknown and non-command input", () => {
	test("an unknown /command is not sent to the pipeline; the closest command is guessed", async () => {
		const { agent, fake } = createAgent();

		await handleInput(agent, "/hepl");

		expect(wasCalled(fake.processTask)).toBe(false);
		expect(calledWith(fake.ui.log, "warn", "airgent", strContaining("Did you mean /help?"))).toBe(
			true,
		);
	});

	test("an unknown /command with nothing close only points to /help", async () => {
		const { agent, fake } = createAgent();

		await handleInput(agent, "/zzzzzzzz");

		expect(wasCalled(fake.processTask)).toBe(false);
		const warning = logged(fake.ui.log).find((m) => m.startsWith("Unknown command"));
		expect(warning).toContain("Type /help");
		expect(warning).not.toContain("Did you mean");
	});

	test("a request that starts with a file path is still a normal task", async () => {
		const { agent, fake } = createAgent();

		await handleInput(agent, "/etc/hosts を確認して");

		expect(calledWith(fake.processTask, "/etc/hosts を確認して")).toBe(true);
		expect(logged(fake.ui.log).some((m) => m.startsWith("Unknown command"))).toBe(false);
	});

	test("plain text is a task", async () => {
		const { agent, fake } = createAgent();

		await handleInput(agent, "fix the login bug");

		expect(calledWith(fake.processTask, "fix the login bug")).toBe(true);
	});
});

describe("handleInput: /help", () => {
	test("lists every command, whatever the letter case of the command word", async () => {
		const { agent, fake } = createAgent();

		await handleInput(agent, "/HELP");

		const text = logged(fake.ui.log).join("\n");
		for (const s of COMMAND_SPECS) expect(text).toContain(s.name);
		expect(wasCalled(fake.processTask)).toBe(false);
	});
});

describe("handleInput: arguments keep the case the user typed", () => {
	test("/copy copies its text as typed", async () => {
		const { agent, fake } = createAgent();

		await handleInput(agent, "/copy Hello World");

		expect(calledWith(fake.ui.copy, "Hello World")).toBe(true);
	});

	test("/sync push passes the remote URL as typed and takes the subcommand in any case", async () => {
		const { agent, fake } = createAgent();

		await handleInput(agent, "/sync PUSH https://github.com/Foo/Bar.git");

		expect(calledWith(fake.deviceSync.initGit, "https://github.com/Foo/Bar.git")).toBe(true);
		expect(wasCalled(fake.deviceSync.push)).toBe(true);
	});

	test("/model accepts a role or all in any letter case", async () => {
		const { agent, fake } = createAgent();

		await handleInput(agent, "/model Planner");
		await handleInput(agent, "/model ALL");

		expect(calledWith(fake.configureModelForRole, "planner")).toBe(true);
		expect(wasCalled(fake.configureModelForAll)).toBe(true);
	});
});
