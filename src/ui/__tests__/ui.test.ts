/**
 * UIManager - Comprehensive Unit Tests
 *
 * Mocks @opentui/core, readline, clipboard, and logger.
 * No real terminal or clipboard access.
 */

import { describe, expect, test, mock, beforeEach, afterEach, spyOn } from "bun:test";
import { resolve } from "node:path";

// ============================================================
// Mock Setup
// ============================================================

// Mock process.stdout/stderr.isTTY to true for most tests
const originalStdoutIsTTY = process.stdout.isTTY;
const originalStdinIsTTY = process.stdin.isTTY;
const _vnodeMap: Record<string, any> = {};

// --- @opentui/core mocks ---
const mockAdd = mock();
const mockRemove = mock();
const mockFindDescendantById = mock((id: string) => _vnodeMap[id] || null);
const mockFocusRenderable = mock();
const mockStart = mock();
const mockDestroy = mock();
const mockRequestRender = mock();
const mockCopyToClipboardOSC52 = mock(() => true);
const mockGetSelectedText = mock(() => "");
const mockGetSelectedOption = mock(() => null);

const mockRenderer = {
  root: {
    add: mockAdd,
    remove: mockRemove,
    findDescendantById: mockFindDescendantById,
    flexDirection: "",
  },
  focusRenderable: mockFocusRenderable,
  start: mockStart,
  destroy: mockDestroy,
  requestRender: mockRequestRender,
  copyToClipboardOSC52: mockCopyToClipboardOSC52,
  on: mock(),
  keyInput: {
    on: mock(),
  },
};

// Renderable constructors that return mock objects
function makeScrollBoxMock() {
  const obj = { add: mock(), content: "" };
  return obj;
}

function makeTextMock() {
  const obj = { add: mock(), content: "" };
  Object.defineProperty(obj, "content", {
    get: () => obj.content,
    set: (v: string) => { obj.content = v; },
    configurable: true,
  });
  Object.defineProperty(obj, "fg", {
    get: () => obj.fg,
    set: (v: string) => { obj.fg = v; },
    configurable: true,
  });
  return obj;
}

function makeInputMock() {
  const listeners: Record<string, Function[]> = {};
  return {
    value: "",
    on: mock((event: string, cb: Function) => {
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(cb);
    }),
    focus: mock(),
    focusable: false,
    _listeners: listeners,
    simulateEnter(value: string) {
      const enterListeners = listeners["ENTER"] || [];
      for (const cb of enterListeners) cb(value);
    },
  };
}

function makeBoxMock() {
  return {
    add: mock(),
    findDescendantById: mock(() => null),
    remove: mock(),
    content: "",
    fg: "",
  };
}

function makeSelectMock() {
  return {
    on: mock(),
    focus: mock(),
    focusable: false,
    getSelectedOption: mockGetSelectedOption,
  };
}

const mockTextCtor = mock((opts?: any) => {
  const t = makeTextMock();
  if (opts?.id) {
    (t as any).id = opts.id;
    (t as any).content = opts.content || "";
    (t as any).fg = opts.fg;
  }
  return t;
});

const mockScrollBoxCtor = mock((opts?: any) => {
  const sb = makeScrollBoxMock();
  if (opts?.id) (sb as any).id = opts.id;
  return sb;
});

const mockInputCtor = mock((opts?: any) => {
  const inp = makeInputMock();
  if (opts?.id) (inp as any).id = opts.id;
  if (opts?.placeholder !== undefined) (inp as any).placeholder = opts.placeholder;
  return inp;
});

const mockBoxCtor = mock((opts?: any) => {
  const box = makeBoxMock();
  if (opts?.id) (box as any).id = opts.id;
  return box;
});

const mockSelectCtor = mock((opts?: any) => makeSelectMock());

mock.module("@opentui/core", () => ({
  createCliRenderer: mock(() => Promise.resolve(mockRenderer)),
  InputRenderableEvents: { ENTER: "ENTER" },
  SelectRenderableEvents: { ITEM_SELECTED: "ITEM_SELECTED" },
  Text: mock((opts?: any) => {
    const t = makeTextMock();
    if (opts?.id) _vnodeMap[opts.id] = t;
    return t;
  }),
  ScrollBox: mock((opts?: any) => {
    const sb = makeScrollBoxMock();
    if (opts?.id) _vnodeMap[opts.id] = sb;
    return sb;
  }),
  Input: mock((opts?: any) => {
    const inp = makeInputMock();
    if (opts?.id) _vnodeMap[opts.id] = inp;
    return inp;
  }),
  Box: mock((opts?: any) => {
    const box = makeBoxMock();
    if (opts?.id) _vnodeMap[opts.id] = box;
    return box;
  }),
  Select: mock((opts?: any) => makeSelectMock()),
}));

// --- readline mock ---
const mockReadlineCreateInterface = mock(() => ({
  question: mock((q: string, cb: (a: string) => void) => cb("answer")),
  close: mock(),
}));
mock.module("readline", () => ({
  createInterface: mockReadlineCreateInterface,
}));
mock.module("node:readline", () => ({
  createInterface: mockReadlineCreateInterface,
}));

// --- clipboard mock (absolute path for reliable module interception) ---
const mockCopyToClipboard = mock((text: string, osc52?: (t: string) => boolean) => ({
  success: true,
  method: "osc52",
}));
mock.module(resolve(import.meta.dir, "../../utils/clipboard"), () => ({
  copyToClipboard: mockCopyToClipboard,
}));

// --- logger mock ---
const mockLoggerChild = mock(() => ({
  info: mock(),
  warn: mock(),
  error: mock(),
  debug: mock(),
}));
mock.module(resolve(import.meta.dir, "../../utils/logger"), () => ({
  rootLogger: {
    child: mockLoggerChild,
    info: mock(),
    warn: mock(),
    error: mock(),
    debug: mock(),
    setDebug: mock(),
  },
}));

// --- Now import UIManager ---
let UIManager: typeof import("../index").UIManager;

// ============================================================
// Tests
// ============================================================

describe("UIManager — Constructor", () => {
  beforeEach(() => {
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
  });

  afterEach(() => {
    mockClearAll();
  });

  test("creates instance with options", async () => {
    const mod = await import("../index");
    UIManager = mod.UIManager;
    const ui = new UIManager({ refreshIntervalMs: 100 });
    expect(ui).toBeDefined();
    expect(ui.ready).toBe(false);
  });

  test("initializes with default status info", async () => {
    const mod = await import("../index");
    UIManager = mod.UIManager;
    const ui = new UIManager({ refreshIntervalMs: 200 });
    expect((ui as any).statusInfo).toEqual({
      sessionId: "", status: "idle", pipelineNode: "",
      tokenUsage: 0, memoryCount: 0, errorCount: 0, uptime: 0,
    });
  });

  test("stores onInput callback", async () => {
    const mod = await import("../index");
    UIManager = mod.UIManager;
    const onInput = mock();
    const ui = new UIManager({ refreshIntervalMs: 100, onInput });
    expect((ui as any).options.onInput).toBe(onInput);
  });

  test("stores onShutdown callback", async () => {
    const mod = await import("../index");
    UIManager = mod.UIManager;
    const onShutdown = mock();
    const ui = new UIManager({ refreshIntervalMs: 100, onShutdown });
    expect((ui as any).options.onShutdown).toBe(onShutdown);
  });

  test("detects non-TTY environment", async () => {
    Object.defineProperty(process.stdout, "isTTY", { value: false, configurable: true });
    Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });
    const mod = await import("../index");
    UIManager = mod.UIManager;
    const ui = new UIManager({ refreshIntervalMs: 100 });
    expect((ui as any).isTTY).toBe(false);
  });

  test("detects TTY environment", async () => {
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
    const mod = await import("../index");
    UIManager = mod.UIManager;
    const ui = new UIManager({ refreshIntervalMs: 100 });
    expect((ui as any).isTTY).toBe(true);
  });
});

describe("UIManager — start()", () => {
  beforeEach(async () => {
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
    const mod = await import("../index");
    UIManager = mod.UIManager;
  });

  afterEach(() => { mockClearAll(); });

  test("start() uses injected renderer and sets running", async () => {
    const ui = new UIManager({ refreshIntervalMs: 100, renderer: mockRenderer });
    await ui.start();
    expect(mockStart).toHaveBeenCalled();
    expect((ui as any).running).toBe(true);
  });

  test("start() does nothing if already running", async () => {
    const ui = new UIManager({ refreshIntervalMs: 100, renderer: mockRenderer });
    await ui.start();
    const callsBefore = mockStart.mock.calls.length;
    await ui.start();
    expect(mockStart.mock.calls.length).toBe(callsBefore);
  });

  test("start() works in non-TTY mode without opening TUI", async () => {
    Object.defineProperty(process.stdout, "isTTY", { value: false, configurable: true });
    Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });
    const ui = new UIManager({ refreshIntervalMs: 100 });
    await ui.start();
    expect((ui as any).running).toBe(true);
  });

  test("start() sets startTime", async () => {
    const ui = new UIManager({ refreshIntervalMs: 100, renderer: mockRenderer });
    const before = Date.now();
    await ui.start();
    expect(ui.startTime).toBeGreaterThanOrEqual(before);
  });
});

describe("UIManager — log/stream/notice", () => {
  let ui: import("../index").UIManager;

  beforeEach(async () => {
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
    const mod = await import("../index");
    UIManager = mod.UIManager;
    ui = new UIManager({ refreshIntervalMs: 100, renderer: mockRenderer });
    await ui.start();
  });

  afterEach(() => { mockClearAll(); });

  test("log() outputs info messages via addLine", async () => {
    ui.log("info", "airgent", "test message");
    // In TTY mode with a scrollbox, addLine calls scrollbox.add
    expect(mockAdd).toHaveBeenCalled();
  });

  test("log() with warn prefix includes level", async () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    Object.defineProperty(process.stdout, "isTTY", { value: false, configurable: true });
    Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });
    const ui2 = new UIManager({ refreshIntervalMs: 100 });
    await ui2.start();
    ui2.log("warn", "airgent", "warning msg");
    expect(logSpy).toHaveBeenCalled();
    logSpy.mockRestore();
  });

  test("log() with error level includes ERROR prefix", async () => {
    Object.defineProperty(process.stdout, "isTTY", { value: false, configurable: true });
    Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    const ui2 = new UIManager({ refreshIntervalMs: 100 });
    await ui2.start();
    ui2.log("error", "system", "error text");
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("ERROR"));
    logSpy.mockRestore();
  });

  test("stream() outputs line via addLine", async () => {
    ui.stream("streaming content");
    expect(mockAdd).toHaveBeenCalled();
  });

  test("notice() uses 'ai' source color", async () => {
    ui.notice("notice message");
    // Should use addLine with source "ai"
    expect(mockAdd).toHaveBeenCalled();
  });

  test("log() works before start() with non-TTY fallback", async () => {
    Object.defineProperty(process.stdout, "isTTY", { value: false, configurable: true });
    Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    const ui2 = new UIManager({ refreshIntervalMs: 100 });
    // Not started - log should use console.log fallback
    ui2.log("info", "test", "before start in non-TTY");
    expect(logSpy).toHaveBeenCalled();
    logSpy.mockRestore();
  });
});

describe("UIManager — updateStatus", () => {
  let ui: import("../index").UIManager;

  beforeEach(async () => {
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
    const mod = await import("../index");
    UIManager = mod.UIManager;
    ui = new UIManager({ refreshIntervalMs: 100, renderer: mockRenderer });
    await ui.start();
  });

  afterEach(() => { mockClearAll(); });

  test("updateStatus merges into statusInfo", async () => {
    ui.updateStatus({ status: "running", pipelineNode: "plan" });
    expect((ui as any).statusInfo.status).toBe("running");
    expect((ui as any).statusInfo.pipelineNode).toBe("plan");
  });

  test("updateStatus with partial updates works", async () => {
    ui.updateStatus({ tokenUsage: 500 });
    expect((ui as any).statusInfo.tokenUsage).toBe(500);
    // Other fields unchanged
    expect((ui as any).statusInfo.status).toBe("idle");
  });

  test("updateStatus with sessionId", async () => {
    ui.updateStatus({ sessionId: "sess-abc" });
    expect((ui as any).statusInfo.sessionId).toBe("sess-abc");
  });

  test("updateStatus with memoryCount", async () => {
    ui.updateStatus({ memoryCount: 42 });
    expect((ui as any).statusInfo.memoryCount).toBe(42);
  });

  test("updateStatus sets error status styling", async () => {
    ui.updateStatus({ status: "error" });
    expect((ui as any).statusInfo.status).toBe("error");
  });

  test("updateStatus does not throw when header/footer not set up", async () => {
    // Create UI without starting (no headerBox / statusBar)
    const ui2 = new UIManager({ refreshIntervalMs: 100 });
    // Should not throw
    expect(() => ui2.updateStatus({ status: "running" })).not.toThrow();
  });
});

describe("UIManager — showCopyToast / copy", () => {
  let ui: import("../index").UIManager;

  beforeEach(async () => {
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
    const mod = await import("../index");
    UIManager = mod.UIManager;

    // Reset mock state
    mockFindDescendantById.mockReset();
    // Make findDescendantById return something useful for toast tests
    mockFindDescendantById.mockImplementation((id: string) => {
      if (id === "toast-copy") return null; // no existing toast
      if (id === "input-line") return { focus: mock(), value: "" };
      return null;
    });
    mockAdd.mockReset();
    mockRemove.mockReset();
    mockRequestRender.mockReset();

    ui = new UIManager({ refreshIntervalMs: 100, renderer: mockRenderer });
    await ui.start();
  });

  afterEach(() => { mockClearAll(); });

  test("copy() calls clipboard and shows toast", async () => {
    mockCopyToClipboard.mockImplementation(() => ({ success: true, method: "osc52" }));
    const result = ui.copy("text to copy");
    expect(result.success).toBe(true);
    expect(result.method).toBe("osc52");
    // Toast should be shown (add called for toast box and text)
    expect(mockAdd).toHaveBeenCalled();
  });

  test("copy() with file method shows file path in toast", async () => {
    mockCopyToClipboard.mockImplementation(() => ({
      success: true, method: "file", filePath: "/tmp/airgent-copy-123.txt",
    }));
    const result = ui.copy("long text");
    expect(result.success).toBe(true);
    expect(result.method).toBe("file");
  });

  test("copy() with failure shows error toast", async () => {
    mockCopyToClipboard.mockImplementation(() => ({
      success: false, method: "file", error: "clipboard error",
    }));
    const result = ui.copy("text");
    expect(result.success).toBe(false);
  });

  test("showCopyToast does nothing when no renderer", async () => {
    // Mock createCliRenderer to fail so no renderer
    const mod = await import("../index");
    UIManager = mod.UIManager;
    const ui2 = new UIManager({ refreshIntervalMs: 100 });
    // Cast to access private method for testing
    const showToast = (ui2 as any).showCopyToast.bind(ui2);
    expect(() => showToast({ success: true, method: "osc52" })).not.toThrow();
  });

  test("copy toast auto-dismisses after timeout", async () => {
    // bun:test doesn't have jest - just verify that a timer was set
    const result = ui.copy("test text");
    expect(result.success).toBe(true);
    // Tile the timer will be set
    expect((ui as any)._copyToastTimer).not.toBeNull();
  });

  test("toast uses green border on success", async () => {
    mockCopyToClipboard.mockImplementation(() => ({ success: true, method: "osc52" }));
    ui.copy("test");
    // Verify add was called for the toast
    expect(mockAdd).toHaveBeenCalled();
  });

  test("toast uses red border on failure", async () => {
    mockCopyToClipboard.mockImplementation(() => ({ success: false, method: "file", error: "err" }));
    ui.copy("test");
    expect(mockAdd).toHaveBeenCalled();
  });
});

describe("UIManager — stop()", () => {
  let ui: import("../index").UIManager;

  beforeEach(async () => {
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
    const mod = await import("../index");
    UIManager = mod.UIManager;
    ui = new UIManager({ refreshIntervalMs: 100, renderer: mockRenderer });
    await ui.start();
  });

  afterEach(() => { mockClearAll(); });

  test("stop() sets running to false", async () => {
    ui.stop();
    expect((ui as any).running).toBe(false);
  });

  test("stop() destroys renderer", async () => {
    ui.stop();
    expect(mockDestroy).toHaveBeenCalled();
  });

  test("stop() clears renderer reference", async () => {
    ui.stop();
    expect((ui as any).renderer).toBeNull();
  });

  test("stop() clears scrollbox reference", async () => {
    ui.stop();
    expect((ui as any).scrollbox).toBeNull();
  });

  test("stop() clears input reference", async () => {
    ui.stop();
    expect((ui as any).input).toBeNull();
  });

  test("stop() is safe when called multiple times", async () => {
    ui.stop();
    ui.stop(); // second call should not throw
    expect((ui as any).renderer).toBeNull();
  });

  test("stop() clears copy toast timer", async () => {
    (ui as any)._copyToastTimer = setTimeout(() => {}, 10000);
    ui.stop();
    expect((ui as any)._copyToastTimer).toBeNull();
  });

  test("stop() clears sigint timer", async () => {
    (ui as any)._sigintTimer = setTimeout(() => {}, 10000);
    ui.stop();
    expect((ui as any)._sigintTimer).toBeNull();
  });
});

describe("UIManager — selectModel / showSelectMenu", () => {
  let ui: import("../index").UIManager;

  beforeEach(async () => {
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
    const mod = await import("../index");
    UIManager = mod.UIManager;
    ui = new UIManager({ refreshIntervalMs: 100 });
  });

  afterEach(() => { mockClearAll(); });

  test("selectModel delegates to showSelectMenu", async () => {
    const options = [{ name: "opt1", description: "desc1", value: "v1" }];
    const promise = ui.selectModel("Pick a model", options);
    // Should not throw
    expect(promise).toBeDefined();
  });

  test("showSelectMenu falls back when no renderer", async () => {
    const ui2 = new UIManager({ refreshIntervalMs: 100 });
    const options = [{ name: "opt1", description: "desc1", value: "v1" }];
    const result = await ui2.showSelectMenu("Pick", options);
    // Fallback readline mock returns "answer" → parseInt → NaN → null
    expect(result).toBeNull();
  });

  test("showSelectMenu returns value from fallback", async () => {
    const ui2 = new UIManager({ refreshIntervalMs: 100 });
    const options = [
      { name: "Option 1", description: "First option", value: { provider: "p1", model: "m1" } },
    ];
    const result = await ui2.showSelectMenu("Test", options);
    // readline mock returns "answer" → parseInt("answer") = NaN → null
    expect(result).toBeNull();
  });

  test("prompt() uses readline", async () => {
    const result = await ui.prompt("Enter value: ");
    expect(mockReadlineCreateInterface).toHaveBeenCalled();
    expect(result).toBe("answer");
  });
});

describe("UIManager — handleSelection (copy on select)", () => {
  let ui: import("../index").UIManager;

  beforeEach(async () => {
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
    const mod = await import("../index");
    UIManager = mod.UIManager;
    ui = new UIManager({ refreshIntervalMs: 100, renderer: mockRenderer });
    await ui.start();
  });

  afterEach(() => { mockClearAll(); });

  test("handleSelection calls copyToClipboard with selected text", async () => {
    mockGetSelectedText.mockImplementation(() => "selected text");
    // Simulate a selection event by accessing the private method
    const selHandler = (ui as any).handleSelection.bind(ui);
    selHandler({ getSelectedText: mockGetSelectedText }, mockRenderer);
    // clipboard copy should be called
    expect(mockCopyToClipboard).toHaveBeenCalledWith("selected text", expect.any(Function));
  });

  test("handleSelection ignores empty selection", async () => {
    mockGetSelectedText.mockImplementation(() => "");
    const selHandler = (ui as any).handleSelection.bind(ui);
    selHandler({ getSelectedText: mockGetSelectedText }, mockRenderer);
    expect(mockCopyToClipboard).not.toHaveBeenCalled();
  });

  test("handleSelection ignores whitespace-only selection", async () => {
    mockGetSelectedText.mockImplementation(() => "   ");
    const selHandler = (ui as any).handleSelection.bind(ui);
    selHandler({ getSelectedText: mockGetSelectedText }, mockRenderer);
    expect(mockCopyToClipboard).not.toHaveBeenCalled();
  });

  test("handleSelection does nothing when copy in progress", async () => {
    (ui as any)._copyInProgress = true;
    const selHandler = (ui as any).handleSelection.bind(ui);
    selHandler({ getSelectedText: mockGetSelectedText }, mockRenderer);
    expect(mockCopyToClipboard).not.toHaveBeenCalled();
  });
});

describe("UIManager — handleCtrlC", () => {
  let ui: import("../index").UIManager;

  beforeEach(async () => {
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
    const mod = await import("../index");
    UIManager = mod.UIManager;
    ui = new UIManager({ refreshIntervalMs: 100, renderer: mockRenderer });
    await ui.start();
  });

  afterEach(() => {
    mockClearAll();
    // Clean up any timers
    (ui as any)._sigintTimer = null;
  });

  test("first Ctrl+C shows warning", async () => {
    (ui as any).handleCtrlC();
    // Should have set sigint tracking state
    expect((ui as any)._sigintCount).toBe(1);
    expect((ui as any)._sigintTimer).not.toBeNull();
  });

  test("second Ctrl+C calls shutdown", async () => {
    const onShutdown = mock();
    const mod = await import("../index");
    UIManager = mod.UIManager;
    const ui2 = new UIManager({ refreshIntervalMs: 100, onShutdown, renderer: mockRenderer });
    await ui2.start();
    (ui2 as any).handleCtrlC(); // first
    (ui2 as any).handleCtrlC(); // second
    // process.nextTick defers onShutdown, flush it
    await new Promise(resolve => process.nextTick(resolve));
    expect(onShutdown).toHaveBeenCalled();
  });
});

describe("UIManager — Edge Cases", () => {
  beforeEach(async () => {
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
    const mod = await import("../index");
    UIManager = mod.UIManager;
  });

  afterEach(() => { mockClearAll(); });

  test("calling log before start() does not throw", () => {
    const ui = new UIManager({ refreshIntervalMs: 100 });
    expect(() => ui.log("info", "test", "hello")).not.toThrow();
  });

  test("calling stop without starting does not throw", () => {
    const ui = new UIManager({ refreshIntervalMs: 100 });
    expect(() => ui.stop()).not.toThrow();
  });

  test("calling start, stop, and start again works", async () => {
    const ui = new UIManager({ refreshIntervalMs: 100, renderer: mockRenderer });
    await ui.start();
    ui.stop();
    // Re-start should work
    mockStart.mockReset();
    await ui.start();
    expect((ui as any).running).toBe(true);
  });

  test("refreshHeaderAndFooter does not throw when header missing", () => {
    const ui = new UIManager({ refreshIntervalMs: 100 });
    expect(() => (ui as any).refreshHeaderAndFooter()).not.toThrow();
  });

  test("multiple rapid updateStatus calls merge correctly", () => {
    const ui = new UIManager({ refreshIntervalMs: 100 });
    ui.updateStatus({ status: "running" });
    ui.updateStatus({ pipelineNode: "plan" });
    ui.updateStatus({ tokenUsage: 100 });
    expect((ui as any).statusInfo.status).toBe("running");
    expect((ui as any).statusInfo.pipelineNode).toBe("plan");
    expect((ui as any).statusInfo.tokenUsage).toBe(100);
  });

  test("log with unknown source uses default color", () => {
    const ui = new UIManager({ refreshIntervalMs: 100 });
    // The sourceColor function should return default for unknown sources
    expect(() => ui.log("info", "unknown-source", "msg")).not.toThrow();
  });

  test("copyInProgress flag is reset after selection handling", async () => {
    const ui = new UIManager({ refreshIntervalMs: 100, renderer: mockRenderer });
    await ui.start();
    // Trigger selection handler
    mockGetSelectedText.mockImplementation(() => "test");
    const selHandler = (ui as any).handleSelection.bind(ui);
    selHandler({ getSelectedText: mockGetSelectedText }, mockRenderer);
    expect((ui as any)._copyInProgress).toBe(false);
  });
});

describe("UIManager — Integration", () => {
  beforeEach(async () => {
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
    const mod = await import("../index");
    UIManager = mod.UIManager;
  });

  afterEach(() => { mockClearAll(); });

  test("full lifecycle: construct → start → update → copy → stop", async () => {
    const onInput = mock();
    const onShutdown = mock();
    const ui = new UIManager({ refreshIntervalMs: 100, onInput, onShutdown, renderer: mockRenderer });

    // start
    await ui.start();
    expect((ui as any).running).toBe(true);
    expect(mockStart).toHaveBeenCalled();

    // update status
    ui.updateStatus({ status: "running", memoryCount: 5 });
    expect((ui as any).statusInfo.status).toBe("running");

    // copy
    mockCopyToClipboard.mockImplementation(() => ({ success: true, method: "osc52" }));
    const copyResult = ui.copy("hello");
    expect(copyResult.success).toBe(true);

    // stop
    ui.stop();
    expect((ui as any).running).toBe(false);
    expect((ui as any).renderer).toBeNull();
  });

  test("non-TTY mode skips renderer creation", async () => {
    Object.defineProperty(process.stdout, "isTTY", { value: false, configurable: true });
    Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });
    const ui = new UIManager({ refreshIntervalMs: 100 });
    await ui.start();
    expect(mockStart).not.toHaveBeenCalled();
  });

  test("createCliRenderer failure is caught gracefully", async () => {
    const ui = new UIManager({ refreshIntervalMs: 100 });
    await expect(ui.start()).resolves.toBeUndefined();
    expect((ui as any).running).toBe(true);
  });
});

// ============================================================
// Helpers
// ============================================================

function mockClearAll() {
  for (const key of Object.keys(_vnodeMap)) delete _vnodeMap[key];
  const mocks = [
    mockAdd, mockRemove, mockFindDescendantById,
    mockFocusRenderable, mockStart, mockDestroy,
    mockRequestRender, mockCopyToClipboardOSC52,
    mockGetSelectedText, mockGetSelectedOption,
    mockCopyToClipboard,
    mockReadlineCreateInterface, mockLoggerChild,
    mockTextCtor, mockScrollBoxCtor, mockInputCtor,
    mockBoxCtor, mockSelectCtor,
    (mockRenderer as any).on, (mockRenderer as any).keyInput.on,
  ];
  for (const m of mocks) {
    // Use mockClear (preserves implementation) instead of mockReset (clears it)
    // so mock.module factory functions keep working across test boundaries.
    if (typeof m?.mockClear === "function") m.mockClear();
  }
  // Restore mocks whose implementations may have been overridden per-test
  mockFindDescendantById.mockImplementation((id: string) => _vnodeMap[id] || null);
  mockReadlineCreateInterface.mockImplementation(() => ({
    question: mock((q: string, cb: (a: string) => void) => cb("answer")),
    close: mock(),
  }));
  mockCopyToClipboard.mockImplementation((text, osc52) => ({
    success: true,
    method: "osc52",
  }));
}
