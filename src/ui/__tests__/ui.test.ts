/**
 * UIManager - Comprehensive Unit Tests (DI-based)
 */

import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { InputRenderableEvents } from "@opentui/core";
import { callCount, calledWith, spy, strContaining, wasCalled } from "../../__tests__/spy-utils";
import type { StatusInfo, UIDeps } from "../index";
import { UIManager } from "../index";

let _vnodeMap: Record<string, any>;

function makeTextNode(opts?: any) {
	const node: any = { add: spy(), content: opts?.content ?? "", fg: opts?.fg ?? "" };
	if (opts?.id) _vnodeMap[opts.id] = node;
	return node;
}

function makeScrollBoxNode(opts?: any) {
	const node: any = { add: spy(), content: "" };
	if (opts?.id) _vnodeMap[opts.id] = node;
	return node;
}

function makeMockRenderer() {
	return {
		root: {
			add: spy(),
			remove: spy(),
			findDescendantById: spy((id: string) => _vnodeMap[id] || null),
			flexDirection: "",
		},
		focusRenderable: spy(),
		start: spy(),
		destroy: spy(),
		requestRender: spy(),
		copyToClipboardOSC52: spy(() => true),
		on: spy(),
		keyInput: { on: spy() },
	};
}

function makeInputNode(opts?: any) {
	const listeners: Record<string, Function[]> = {};
	const node: any = {
		value: "",
		placeholder: opts?.placeholder,
		on: spy((event: string, cb: Function) => {
			if (!listeners[event]) listeners[event] = [];
			listeners[event].push(cb);
		}),
		focus: spy(),
		focusable: false,
		simulateEnter(value: string) {
			for (const cb of listeners.ENTER || []) cb(value);
		},
	};
	if (opts?.id) _vnodeMap[opts.id] = node;
	return node;
}

function makeSelectNode(opts?: any) {
	const node: any = {
		on: spy(),
		focus: spy(),
		focusable: false,
		getSelectedOption: spy(() => null),
	};
	if (opts?.id) _vnodeMap[opts.id] = node;
	return node;
}

function makeBoxNode(opts?: any) {
	const node: any = {
		add: spy(),
		remove: spy(),
		findDescendantById: spy((id: string) => _vnodeMap[id] || null),
		content: "",
		fg: "",
	};
	if (opts?.id) _vnodeMap[opts.id] = node;
	return node;
}

function makeMockDeps(): UIDeps {
	return {
		readline: {
			createInterface: spy(() => ({
				question: spy((_q: string, cb: (a: string) => void) => cb("answer")),
				close: spy(),
			})),
		},
		renderable: {
			Box: spy(makeBoxNode),
			Text: spy(makeTextNode),
			ScrollBox: spy(makeScrollBoxNode),
			Input: spy(makeInputNode),
			Select: spy(makeSelectNode),
			createCliRenderer: spy(async () => makeMockRenderer()),
		},
		copyToClipboard: spy(() => ({ success: true, method: "osc52" }) as any),
		logger: {
			info: spy(),
			warn: spy(),
			error: spy(),
			debug: spy(),
		} as any,
	} as unknown as UIDeps;
}

function setTTY(value: boolean) {
	Object.defineProperty(process.stdout, "isTTY", { value, configurable: true });
	Object.defineProperty(process.stdin, "isTTY", { value, configurable: true });
}

// ============================================================
// Tests
// ============================================================

describe("UIManager — Constructor", () => {
	beforeEach(() => {
		_vnodeMap = {};
		setTTY(true);
	});

	afterEach(() => {
		setTTY(true);
	});

	test("creates instance with options", () => {
		const ui = new UIManager({ refreshIntervalMs: 100 }, makeMockDeps());
		expect(ui).toBeDefined();
		expect(ui.ready).toBe(false);
	});

	test("initializes with default status info", () => {
		const ui = new UIManager({ refreshIntervalMs: 200 }, makeMockDeps());
		expect((ui as unknown as { statusInfo: StatusInfo }).statusInfo).toEqual({
			sessionId: "",
			status: "idle",
			pipelineNode: "",
			tokenUsage: 0,
			memoryCount: 0,
			errorCount: 0,
			uptime: 0,
		});
	});

	test("stores onInput callback", () => {
		const onInput = spy();
		const ui = new UIManager({ refreshIntervalMs: 100, onInput }, makeMockDeps());
		expect((ui as any).options.onInput).toBe(onInput);
	});

	test("stores onShutdown callback", () => {
		const onShutdown = spy();
		const ui = new UIManager({ refreshIntervalMs: 100, onShutdown }, makeMockDeps());
		expect((ui as any).options.onShutdown).toBe(onShutdown);
	});

	test("detects non-TTY environment", () => {
		setTTY(false);
		const ui = new UIManager({ refreshIntervalMs: 100 }, makeMockDeps());
		expect((ui as any).isTTY).toBe(false);
	});

	test("detects TTY environment", () => {
		setTTY(true);
		const ui = new UIManager({ refreshIntervalMs: 100 }, makeMockDeps());
		expect((ui as any).isTTY).toBe(true);
	});

	test("uses default deps when none provided", () => {
		expect(() => new UIManager({ refreshIntervalMs: 100 })).not.toThrow();
	});
});

describe("UIManager — start()", () => {
	beforeEach(() => {
		_vnodeMap = {};
		setTTY(true);
	});

	afterEach(() => {
		setTTY(true);
	});

	test("start() uses injected renderer and sets running", async () => {
		const deps = makeMockDeps();
		const ui = new UIManager({ refreshIntervalMs: 100 }, deps);
		await ui.start();
		const renderer = (ui as any).renderer;
		expect(wasCalled(renderer.start)).toBe(true);
		expect((ui as any).running).toBe(true);
	});

	test("start() does nothing if already running", async () => {
		const deps = makeMockDeps();
		const ui = new UIManager({ refreshIntervalMs: 100 }, deps);
		await ui.start();
		const renderer = (ui as any).renderer;
		const callsBefore = callCount(renderer.start);
		await ui.start();
		expect(callCount(renderer.start)).toBe(callsBefore);
	});

	test("start() works in non-TTY mode without opening TUI", async () => {
		setTTY(false);
		const ui = new UIManager({ refreshIntervalMs: 100 }, makeMockDeps());
		await ui.start();
		expect((ui as any).running).toBe(true);
	});

	test("start() sets startTime", async () => {
		const ui = new UIManager({ refreshIntervalMs: 100 }, makeMockDeps());
		const before = Date.now();
		await ui.start();
		expect(ui.startTime).toBeGreaterThanOrEqual(before);
	});
});

describe("UIManager — log/stream/notice", () => {
	let ui: UIManager;
	let deps: UIDeps;

	beforeEach(async () => {
		_vnodeMap = {};
		setTTY(true);
		deps = makeMockDeps();
		ui = new UIManager({ refreshIntervalMs: 100 }, deps);
		await ui.start();
	});

	test("log() outputs info messages via addLine", () => {
		const scrollbox = (ui as any).scrollbox;
		ui.log("info", "airgent", "test message");
		expect(wasCalled(scrollbox.add)).toBe(true);
	});

	test("log() with warn prefix includes level", async () => {
		const logSpy = spyOn(console, "log").mockImplementation(() => {});
		setTTY(false);
		const ui2 = new UIManager({ refreshIntervalMs: 100 }, makeMockDeps());
		await ui2.start();
		ui2.log("warn", "airgent", "warning msg");
		expect(logSpy).toHaveBeenCalled();
		logSpy.mockRestore();
	});

	test("log() with error level includes ERROR prefix", async () => {
		setTTY(false);
		const logSpy = spyOn(console, "log").mockImplementation(() => {});
		const ui2 = new UIManager({ refreshIntervalMs: 100 }, makeMockDeps());
		await ui2.start();
		ui2.log("error", "system", "error text");
		expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("ERROR"));
		logSpy.mockRestore();
	});

	test("stream() outputs line via addLine", () => {
		const scrollbox = (ui as any).scrollbox;
		ui.stream("streaming content");
		expect(wasCalled(scrollbox.add)).toBe(true);
	});

	test("notice() uses 'ai' source color", () => {
		const scrollbox = (ui as any).scrollbox;
		ui.notice("notice message");
		expect(wasCalled(scrollbox.add)).toBe(true);
	});

	test("log() works before start() with non-TTY fallback", async () => {
		setTTY(false);
		const logSpy = spyOn(console, "log").mockImplementation(() => {});
		const ui2 = new UIManager({ refreshIntervalMs: 100 }, makeMockDeps());
		ui2.log("info", "test", "before start in non-TTY");
		expect(logSpy).toHaveBeenCalled();
		logSpy.mockRestore();
	});
});

describe("UIManager — updateStatus", () => {
	let ui: UIManager;

	beforeEach(async () => {
		_vnodeMap = {};
		setTTY(true);
		ui = new UIManager({ refreshIntervalMs: 100 }, makeMockDeps());
		await ui.start();
	});

	test("updateStatus merges into statusInfo", () => {
		ui.updateStatus({ status: "running", pipelineNode: "plan" });
		expect((ui as unknown as { statusInfo: StatusInfo }).statusInfo.status).toBe("running");
		expect((ui as unknown as { statusInfo: StatusInfo }).statusInfo.pipelineNode).toBe("plan");
	});

	test("updateStatus with partial updates works", () => {
		ui.updateStatus({ tokenUsage: 500 });
		expect((ui as unknown as { statusInfo: StatusInfo }).statusInfo.tokenUsage).toBe(500);
		expect((ui as unknown as { statusInfo: StatusInfo }).statusInfo.status).toBe("idle");
	});

	test("updateStatus with sessionId", () => {
		ui.updateStatus({ sessionId: "sess-abc" });
		expect((ui as unknown as { statusInfo: StatusInfo }).statusInfo.sessionId).toBe("sess-abc");
	});

	test("updateStatus with memoryCount", () => {
		ui.updateStatus({ memoryCount: 42 });
		expect((ui as unknown as { statusInfo: StatusInfo }).statusInfo.memoryCount).toBe(42);
	});

	test("updateStatus sets error status styling", () => {
		ui.updateStatus({ status: "error" });
		expect((ui as unknown as { statusInfo: StatusInfo }).statusInfo.status).toBe("error");
	});

	test("updateStatus does not throw when header/footer not set up", () => {
		const ui2 = new UIManager({ refreshIntervalMs: 100 }, makeMockDeps());
		expect(() => ui2.updateStatus({ status: "running" })).not.toThrow();
	});
});

describe("UIManager — showCopyToast/copy", () => {
	let ui: UIManager;
	let deps: UIDeps;

	beforeEach(async () => {
		_vnodeMap = {};
		setTTY(true);
		deps = makeMockDeps();
		ui = new UIManager({ refreshIntervalMs: 100 }, deps);
		await ui.start();
	});

	test("copy() calls copyToClipboard and returns result", () => {
		const result = ui.copy("hello world");
		expect(result.success).toBe(true);
		expect(wasCalled(deps.copyToClipboard)).toBe(true);
	});

	test("copy() passes text as first arg to copyToClipboard", () => {
		ui.copy("some text");
		const calls = (deps.copyToClipboard as unknown as { calls: unknown[][] }).calls;
		expect(calls[0]?.[0]).toBe("some text");
	});

	test("copy() renders toast box on renderer root", () => {
		const renderer = (ui as any).renderer;
		ui.copy("hello");
		expect(wasCalled(renderer.root.add)).toBe(true);
	});

	test("copy() does nothing visible when renderer is null", () => {
		const ui2 = new UIManager({ refreshIntervalMs: 100 }, makeMockDeps());
		expect(() => ui2.copy("text")).not.toThrow();
	});

	test("showCopyToast success message shows 'Copied!'", () => {
		const textSpy = deps.renderable.Text as unknown as { calls: any[][] };
		const before = textSpy.calls.length;
		ui.copy("hi");
		expect(textSpy.calls.length).toBeGreaterThan(before);
		const lastCallArgs = textSpy.calls[textSpy.calls.length - 1]![0];
		expect(lastCallArgs.content).toBe("Copied!");
	});

	test("showCopyToast failure message shows 'Copy failed'", () => {
		const failDeps = {
			...deps,
			copyToClipboard: spy(() => ({ success: false, method: "file" })),
		} as UIDeps;
		const ui2 = new UIManager({ refreshIntervalMs: 100 }, failDeps);
		return ui2.start().then(() => {
			const textSpy = failDeps.renderable.Text as unknown as { calls: any[][] };
			ui2.copy("hi");
			const lastCallArgs = textSpy.calls[textSpy.calls.length - 1]![0];
			expect(lastCallArgs.content).toBe("Copy failed");
		});
	});

	test("showCopyToast file method shows file path", () => {
		const fileDeps = {
			...deps,
			copyToClipboard: spy(() => ({
				success: true,
				method: "file",
				filePath: "/tmp/airgent-copy-123.txt",
			})),
		} as UIDeps;
		const ui2 = new UIManager({ refreshIntervalMs: 100 }, fileDeps);
		return ui2.start().then(() => {
			const textSpy = fileDeps.renderable.Text as unknown as { calls: any[][] };
			ui2.copy("hi");
			const lastCallArgs = textSpy.calls[textSpy.calls.length - 1]![0];
			expect(lastCallArgs.content).toBe("Copied to /tmp/airgent-copy-123.txt");
		});
	});

	test("showCopyToast removes existing toast before adding new one", () => {
		_vnodeMap["toast-copy"] = makeBoxNode({ id: "toast-copy" });
		const renderer = (ui as any).renderer;
		ui.copy("hi");
		expect(wasCalled(renderer.root.remove)).toBe(true);
	});

	test("showCopyToast requests render and refocuses input", () => {
		const renderer = (ui as any).renderer;
		ui.copy("hi");
		expect(wasCalled(renderer.requestRender)).toBe(true);
		expect(wasCalled(renderer.focusRenderable)).toBe(true);
	});
});

describe("UIManager — stop", () => {
	beforeEach(() => {
		_vnodeMap = {};
		setTTY(true);
	});

	afterEach(() => {
		setTTY(true);
	});

	test("stop() sets running to false", async () => {
		const ui = new UIManager({ refreshIntervalMs: 100 }, makeMockDeps());
		await ui.start();
		ui.stop();
		expect((ui as any).running).toBe(false);
	});

	test("stop() calls renderer.destroy()", async () => {
		const ui = new UIManager({ refreshIntervalMs: 100 }, makeMockDeps());
		await ui.start();
		const renderer = (ui as any).renderer;
		ui.stop();
		expect(wasCalled(renderer.destroy)).toBe(true);
	});

	test("stop() nulls out renderer, scrollbox, and input", async () => {
		const ui = new UIManager({ refreshIntervalMs: 100 }, makeMockDeps());
		await ui.start();
		ui.stop();
		expect((ui as any).renderer).toBeNull();
		expect((ui as any).scrollbox).toBeNull();
		expect((ui as any).input).toBeNull();
	});

	test("stop() logs 'UI stopped'", async () => {
		const deps = makeMockDeps();
		const ui = new UIManager({ refreshIntervalMs: 100 }, deps);
		await ui.start();
		ui.stop();
		expect(calledWith(deps.logger.info as any, "UI stopped")).toBe(true);
	});

	test("stop() clears pending sigint timer", async () => {
		const ui = new UIManager({ refreshIntervalMs: 100 }, makeMockDeps());
		await ui.start();
		(ui as any)._sigintTimer = setTimeout(() => {}, 10000);
		ui.stop();
		expect((ui as any)._sigintTimer).toBeNull();
	});

	test("stop() clears pending copy toast timer", async () => {
		const ui = new UIManager({ refreshIntervalMs: 100 }, makeMockDeps());
		await ui.start();
		(ui as any)._copyToastTimer = setTimeout(() => {}, 10000);
		ui.stop();
		expect((ui as any)._copyToastTimer).toBeNull();
	});

	test("stop() is safe to call when renderer was never created (non-TTY)", async () => {
		setTTY(false);
		const ui = new UIManager({ refreshIntervalMs: 100 }, makeMockDeps());
		await ui.start();
		expect(() => ui.stop()).not.toThrow();
	});
});

describe("UIManager — selectModel", () => {
	beforeEach(() => {
		_vnodeMap = {};
		setTTY(true);
	});

	afterEach(() => {
		setTTY(true);
	});

	const options = [
		{ name: "opt-a", description: "first", value: "a" },
		{ name: "opt-b", description: "second", value: "b" },
	];

	test("selectModel() renders a Select overlay when renderer/scrollbox exist", async () => {
		const deps = makeMockDeps();
		const ui = new UIManager({ refreshIntervalMs: 100 }, deps);
		await ui.start();

		const promise = ui.selectModel("Choose one", options);
		const selectCalls = (deps.renderable.Select as unknown as { calls: any[][] }).calls;
		expect(selectCalls.length).toBeGreaterThan(0);

		const selectId = selectCalls[selectCalls.length - 1]![0].id;
		const selectNode = _vnodeMap[selectId];
		selectNode.getSelectedOption = spy(() => ({ value: "b" }));
		const onHandlers = (selectNode.on as unknown as { calls: any[][] }).calls;
		const itemSelectedHandler = onHandlers[onHandlers.length - 1]![1];
		itemSelectedHandler();

		const result = await promise;
		expect(result).toBe("b");
	});

	test("selectModel() falls back to readline prompt when renderer is unavailable", async () => {
		setTTY(false);
		const deps = makeMockDeps();
		const ui = new UIManager({ refreshIntervalMs: 100 }, deps);
		await ui.start();

		const result = await ui.selectModel("Choose one", options);
		expect(wasCalled(deps.readline.createInterface)).toBe(true);
	});

	test("selectModel() fallback resolves selected option by index", async () => {
		setTTY(false);
		const deps = makeMockDeps();
		(deps.readline.createInterface as any) = spy(() => ({
			question: spy((_q: string, cb: (a: string) => void) => cb("2")),
			close: spy(),
		}));
		const ui = new UIManager({ refreshIntervalMs: 100 }, deps);
		await ui.start();

		const result = await ui.selectModel("Choose one", options);
		expect(result).toBe("b");
	});

	test("selectModel() fallback resolves null for invalid index", async () => {
		setTTY(false);
		const deps = makeMockDeps();
		(deps.readline.createInterface as any) = spy(() => ({
			question: spy((_q: string, cb: (a: string) => void) => cb("99")),
			close: spy(),
		}));
		const ui = new UIManager({ refreshIntervalMs: 100 }, deps);
		await ui.start();

		const result = await ui.selectModel("Choose one", options);
		expect(result).toBeNull();
	});
});

describe("UIManager — handleSelection", () => {
	let ui: UIManager;
	let deps: UIDeps;
	let renderer: any;

	beforeEach(async () => {
		_vnodeMap = {};
		setTTY(true);
		deps = makeMockDeps();
		ui = new UIManager({ refreshIntervalMs: 100 }, deps);
		await ui.start();
		renderer = (ui as any).renderer;
	});

	function getSelectionHandler(): (sel: any) => void {
		const onCalls = (renderer.on as unknown as { calls: any[][] }).calls;
		const call = onCalls.find((c) => c[0] === "selection");
		return call![1];
	}

	test("handleSelection copies non-empty selected text", () => {
		const handler = getSelectionHandler();
		const sel = { getSelectedText: spy(() => "selected text") };
		handler(sel);
		expect(wasCalled(deps.copyToClipboard)).toBe(true);
	});

	test("handleSelection ignores whitespace-only selection", () => {
		const handler = getSelectionHandler();
		const sel = { getSelectedText: spy(() => "   ") };
		handler(sel);
		expect(wasCalled(deps.copyToClipboard)).toBe(false);
	});

	test("handleSelection ignores empty selection", () => {
		const handler = getSelectionHandler();
		const sel = { getSelectedText: spy(() => "") };
		handler(sel);
		expect(wasCalled(deps.copyToClipboard)).toBe(false);
	});

	test("handleSelection swallows errors from getSelectedText", () => {
		const handler = getSelectionHandler();
		const sel = {
			getSelectedText: spy(() => {
				throw new Error("boom");
			}),
		};
		expect(() => handler(sel)).not.toThrow();
	});

	test("handleSelection resets _copyInProgress after handling", () => {
		const handler = getSelectionHandler();
		const sel = { getSelectedText: spy(() => "text") };
		handler(sel);
		expect((ui as any)._copyInProgress).toBe(false);
	});

	test("handleSelection skips re-entrant calls while copy is in progress", () => {
		const handler = getSelectionHandler();
		(ui as any)._copyInProgress = true;
		const sel = { getSelectedText: spy(() => "text") };
		handler(sel);
		expect(wasCalled(sel.getSelectedText)).toBe(false);
	});
});

describe("UIManager — handleCtrlC", () => {
	let ui: UIManager;
	let deps: UIDeps;
	let renderer: any;

	beforeEach(async () => {
		_vnodeMap = {};
		setTTY(true);
		deps = makeMockDeps();
	});

	afterEach(() => {
		setTTY(true);
	});

	function getCtrlCHandler(r: any): (event: any) => void {
		const onCalls = (r.keyInput.on as unknown as { calls: any[][] }).calls;
		const call = onCalls.find((c) => c[0] === "keypress");
		return call![1];
	}

	test("first Ctrl+C logs a warning and does not shut down", async () => {
		const onShutdown = spy();
		ui = new UIManager({ refreshIntervalMs: 100, onShutdown }, deps);
		await ui.start();
		renderer = (ui as any).renderer;
		const handler = getCtrlCHandler(renderer);
		const scrollbox = (ui as any).scrollbox;

		handler({ ctrl: true, name: "c", preventDefault: spy() });
		expect(wasCalled(scrollbox.add)).toBe(true);
		expect(wasCalled(onShutdown)).toBe(false);
		expect((ui as any)._sigintCount).toBe(1);
	});

	test("second Ctrl+C within window triggers shutdown", async () => {
		const onShutdown = spy();
		ui = new UIManager({ refreshIntervalMs: 100, onShutdown }, deps);
		await ui.start();
		renderer = (ui as any).renderer;
		const handler = getCtrlCHandler(renderer);

		handler({ ctrl: true, name: "c", preventDefault: spy() });
		handler({ ctrl: true, name: "c", preventDefault: spy() });

		await new Promise((resolve) => process.nextTick(resolve));
		await new Promise((resolve) => process.nextTick(resolve));

		expect(wasCalled(onShutdown)).toBe(true);
	});

	test("second Ctrl+C clears the pending sigint timer", async () => {
		const onShutdown = spy();
		ui = new UIManager({ refreshIntervalMs: 100, onShutdown }, deps);
		await ui.start();
		renderer = (ui as any).renderer;
		const handler = getCtrlCHandler(renderer);

		handler({ ctrl: true, name: "c", preventDefault: spy() });
		expect((ui as any)._sigintTimer).not.toBeNull();
		handler({ ctrl: true, name: "c", preventDefault: spy() });
		expect((ui as any)._sigintTimer).not.toBeNull();
	});

	test("non-ctrl keypress is ignored", async () => {
		const onShutdown = spy();
		ui = new UIManager({ refreshIntervalMs: 100, onShutdown }, deps);
		await ui.start();
		renderer = (ui as any).renderer;
		const handler = getCtrlCHandler(renderer);
		const preventDefault = spy();

		handler({ ctrl: false, name: "c", preventDefault });
		expect(wasCalled(preventDefault)).toBe(false);
		expect((ui as any)._sigintCount).toBe(0);
	});

	test("ctrl key with different letter is ignored", async () => {
		const onShutdown = spy();
		ui = new UIManager({ refreshIntervalMs: 100, onShutdown }, deps);
		await ui.start();
		renderer = (ui as any).renderer;
		const handler = getCtrlCHandler(renderer);
		const preventDefault = spy();

		handler({ ctrl: true, name: "x", preventDefault });
		expect(wasCalled(preventDefault)).toBe(false);
	});
});

describe("UIManager — EdgeCases", () => {
	beforeEach(() => {
		_vnodeMap = {};
		setTTY(true);
	});

	afterEach(() => {
		setTTY(true);
	});

	test("start() catches createCliRenderer failure and logs a warning", async () => {
		const deps = makeMockDeps();
		deps.renderable.createCliRenderer = spy(async () => {
			throw new Error("renderer init failed");
		}) as any;
		const ui = new UIManager({ refreshIntervalMs: 100 }, deps);
		await ui.start();
		expect(wasCalled(deps.logger.warn as any)).toBe(true);
		expect((ui as any).running).toBe(true);
	});

	function getEnterHandler(inputNode: any): (value: string) => void {
		const onCalls = (inputNode.on as unknown as { calls: any[][] }).calls;
		const call = onCalls.find((c) => c[0] === InputRenderableEvents.ENTER);
		return call![1];
	}

	test("ENTER before ready shows waiting message and clears input", async () => {
		const deps = makeMockDeps();
		const onInput = spy();
		const ui = new UIManager({ refreshIntervalMs: 100, onInput }, deps);
		await ui.start();
		const inputNode = (ui as any).input;
		inputNode.value = "some text";
		const handler = getEnterHandler(inputNode);

		handler("some text");
		expect(wasCalled(onInput)).toBe(false);
		expect(inputNode.value).toBe("");
	});

	test("ENTER after ready with non-empty value calls onInput and clears input", async () => {
		const deps = makeMockDeps();
		const onInput = spy();
		const ui = new UIManager({ refreshIntervalMs: 100, onInput }, deps);
		await ui.start();
		ui.ready = true;
		const inputNode = (ui as any).input;
		inputNode.value = "hello";
		const handler = getEnterHandler(inputNode);

		handler("hello");
		expect(wasCalled(onInput)).toBe(true);
		expect(calledWith(onInput, "hello")).toBe(true);
		expect(inputNode.value).toBe("");
	});

	test("ENTER after ready with whitespace-only value does not call onInput", async () => {
		const deps = makeMockDeps();
		const onInput = spy();
		const ui = new UIManager({ refreshIntervalMs: 100, onInput }, deps);
		await ui.start();
		ui.ready = true;
		const inputNode = (ui as any).input;
		const handler = getEnterHandler(inputNode);

		handler("   ");
		expect(wasCalled(onInput)).toBe(false);
	});

	test("askQuestion appends Custom... option by default", async () => {
		const deps = makeMockDeps();
		const ui = new UIManager({ refreshIntervalMs: 100 }, deps);
		await ui.start();

		const q = { query: "pick one", options: [{ label: "A", value: "a" }] };
		const promise = ui.askQuestion(q);

		const selectCalls = (deps.renderable.Select as unknown as { calls: any[][] }).calls;
		const lastOptions = selectCalls[selectCalls.length - 1]![0].options;
		expect(lastOptions.length).toBe(2);
		expect(lastOptions[1].value).toBe("__custom__");

		const selectId = selectCalls[selectCalls.length - 1]![0].id;
		const selectNode = _vnodeMap[selectId];
		selectNode.getSelectedOption = spy(() => ({ value: "a" }));
		const onHandlers = (selectNode.on as unknown as { calls: any[][] }).calls;
		onHandlers[onHandlers.length - 1]![1]();
		await promise;
	});

	test("askQuestion omits Custom... option when allowCustom is false", async () => {
		const deps = makeMockDeps();
		const ui = new UIManager({ refreshIntervalMs: 100 }, deps);
		await ui.start();

		const q = { query: "pick one", options: [{ label: "A", value: "a" }], allowCustom: false };
		const promise = ui.askQuestion(q);

		const selectCalls = (deps.renderable.Select as unknown as { calls: any[][] }).calls;
		const lastOptions = selectCalls[selectCalls.length - 1]![0].options;
		expect(lastOptions.length).toBe(1);

		const selectId = selectCalls[selectCalls.length - 1]![0].id;
		const selectNode = _vnodeMap[selectId];
		selectNode.getSelectedOption = spy(() => ({ value: "a" }));
		const onHandlers = (selectNode.on as unknown as { calls: any[][] }).calls;
		onHandlers[onHandlers.length - 1]![1]();
		await promise;
	});

	test("prompt() resolves with readline answer", async () => {
		const deps = makeMockDeps();
		const ui = new UIManager({ refreshIntervalMs: 100 }, deps);
		const answer = await ui.prompt("Your name: ");
		expect(answer).toBe("answer");
		expect(wasCalled(deps.readline.createInterface)).toBe(true);
	});
});

describe("UIManager — Integration", () => {
	beforeEach(() => {
		_vnodeMap = {};
		setTTY(true);
	});

	afterEach(() => {
		setTTY(true);
	});

	test("full TTY lifecycle: start, log, updateStatus, copy, stop", async () => {
		const deps = makeMockDeps();
		const ui = new UIManager({ refreshIntervalMs: 100 }, deps);

		await ui.start();
		expect((ui as any).running).toBe(true);

		ui.log("info", "airgent", "pipeline started");
		ui.updateStatus({ status: "running", pipelineNode: "plan", tokenUsage: 120 });
		expect((ui as unknown as { statusInfo: StatusInfo }).statusInfo.status).toBe("running");

		const copyResult = ui.copy("some output");
		expect(copyResult.success).toBe(true);

		ui.stop();
		expect((ui as any).running).toBe(false);
		expect((ui as any).renderer).toBeNull();
	});

	test("full non-TTY lifecycle: start, log falls back to console, stop", async () => {
		setTTY(false);
		const logSpy = spyOn(console, "log").mockImplementation(() => {});
		const deps = makeMockDeps();
		const ui = new UIManager({ refreshIntervalMs: 100 }, deps);

		await ui.start();
		expect((ui as any).running).toBe(true);
		expect(wasCalled(deps.renderable.createCliRenderer)).toBe(false);

		ui.log("info", "airgent", "non-tty message");
		expect(logSpy).toHaveBeenCalled();

		ui.stop();
		expect((ui as any).running).toBe(false);
		logSpy.mockRestore();
	});

	test("selection copy flow updates toast and refocuses input end-to-end", async () => {
		const deps = makeMockDeps();
		const ui = new UIManager({ refreshIntervalMs: 100 }, deps);
		await ui.start();

		const renderer = (ui as any).renderer;
		const onCalls = (renderer.on as unknown as { calls: any[][] }).calls;
		const selectionHandler = onCalls.find((c) => c[0] === "selection")![1];

		selectionHandler({ getSelectedText: spy(() => "copied via selection") });

		expect(wasCalled(deps.copyToClipboard)).toBe(true);
		expect(wasCalled(renderer.focusRenderable)).toBe(true);

		ui.stop();
	});

	test("double Ctrl+C during an active session shuts everything down cleanly", async () => {
		const onShutdown = spy();
		const deps = makeMockDeps();
		const ui = new UIManager({ refreshIntervalMs: 100, onShutdown }, deps);
		await ui.start();

		const renderer = (ui as any).renderer;
		const onCalls = (renderer.keyInput.on as unknown as { calls: any[][] }).calls;
		const keyHandler = onCalls.find((c) => c[0] === "keypress")![1];

		keyHandler({ ctrl: true, name: "c", preventDefault: spy() });
		keyHandler({ ctrl: true, name: "c", preventDefault: spy() });

		await new Promise((resolve) => process.nextTick(resolve));
		await new Promise((resolve) => process.nextTick(resolve));

		expect(wasCalled(onShutdown)).toBe(true);
	});
});
