/**
 * Tests for clipboard.ts
 *
 * Uses dependency injection (CopyOverrides) instead of mock.module().
 * mock.module() is process-global in bun:test and leaks to other test files.
 * mock() on node:* namespace objects doesn't affect ESM live bindings.
 *
 * Solution: copyToClipboard() accepts optional overrides for spawnSync/writeFileSync.
 * Tests pass mock functions via overrides. File fallback tests use real fs.
 *
 * Note: static import is used (not dynamic import in beforeAll) to avoid
 * a Bun 1.2.x/aarch64 race where tests run before beforeAll resolves,
 * causing mock() call tracking to silently fail.
 */

import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { copyToClipboard } from "../clipboard";

/** Track temp files created during file-fallback tests for cleanup */
const tempFiles: string[] = [];

/** Simple mock function creator for Bun 1.2.23 compatibility */
function createMock<T extends (...args: any[]) => any>(fn: T): any {
	return mock(fn);
}

/** Helper: returns spawnSync mock that returns success */
function successfulSpawn() {
	return createMock((..._: any[]) => ({
		status: 0,
		stdout: Buffer.from(""),
		stderr: Buffer.from(""),
		pid: 0,
		output: [],
		signal: null,
	})) as unknown as typeof import("node:child_process").spawnSync;
}

/** Helper: returns spawnSync mock that throws */
function throwingSpawn(errorMsg = "command not found") {
	return createMock((..._: any[]) => {
		throw new Error(errorMsg);
	}) as unknown as typeof import("node:child_process").spawnSync;
}

describe("copyToClipboard", () => {
	let originalWaylandDisplay: string | undefined;

	beforeAll(() => {
		originalWaylandDisplay = process.env.WAYLAND_DISPLAY;
	});

	afterAll(() => {
		// Restore WAYLAND_DISPLAY
		if (originalWaylandDisplay !== undefined) {
			process.env.WAYLAND_DISPLAY = originalWaylandDisplay;
		} else {
			delete process.env.WAYLAND_DISPLAY;
		}
		// Clean up temp files created during file fallback tests
		for (const file of tempFiles) {
			try {
				require("node:fs").unlinkSync(file);
			} catch {
				/* already cleaned up */
			}
		}
		tempFiles.length = 0;
	});

	test("OSC52 mode returns success when callback returns true", () => {
		const osc52Fn = mock(() => true);
		const result = copyToClipboard("hello", osc52Fn);
		expect(result.success).toBe(true);
		expect(result.method).toBe("osc52");
		expect(osc52Fn).toHaveBeenCalledWith("hello");
	});

	test("OSC52 mode falls through when callback returns false", () => {
		const osc52Fn = mock(() => false);

		const result = copyToClipboard("hello", osc52Fn, {
			spawnSync: successfulSpawn(),
			platform: "win32",
		});
		expect(result.method).toBe("file");
		if (result.filePath) tempFiles.push(result.filePath);
	});

	test("OSC52 mode falls through when callback throws", () => {
		const osc52Fn = mock(() => {
			throw new Error("osc52 failed");
		});

		const result = copyToClipboard("text", osc52Fn, {
			spawnSync: successfulSpawn(),
			platform: "win32",
		});
		expect(result.method).toBe("file");
		if (result.filePath) tempFiles.push(result.filePath);
	});

	test("pbcopy on macOS returns success with method pbcopy", () => {
		const sp = successfulSpawn();
		const result = copyToClipboard("hello mac", undefined, { spawnSync: sp, platform: "darwin" });
		expect(result.success).toBe(true);
		expect(result.method).toBe("pbcopy");
		expect(sp).toHaveBeenCalledWith("pbcopy", [], {
			input: "hello mac",
			encoding: "utf-8",
		});
	});

	test("pbcopy fall through when spawnSync throws on macOS", () => {
		const result = copyToClipboard("fallback text", undefined, {
			spawnSync: throwingSpawn(),
			platform: "darwin",
		});
		expect(result.method).toBe("file");
		if (result.filePath) tempFiles.push(result.filePath);
	});

	test("pbcopy fall through when status is non-zero on macOS", () => {
		const result = copyToClipboard("fallback text", undefined, {
			spawnSync: mock((..._: any[]) => ({
				status: 1,
				stdout: Buffer.from(""),
				stderr: Buffer.from("error"),
				pid: 0,
				output: [],
				signal: null,
			})) as unknown as typeof import("node:child_process").spawnSync,
			platform: "darwin",
		});
		expect(result.method).toBe("file");
		if (result.filePath) tempFiles.push(result.filePath);
	});

	test("wl-copy on Linux Wayland returns success", () => {
		process.env.WAYLAND_DISPLAY = "wayland-0";

		const sp = successfulSpawn();
		const result = copyToClipboard("wayland text", undefined, {
			spawnSync: sp,
			platform: "linux",
		});
		expect(result.success).toBe(true);
		expect(result.method).toBe("wl-copy");
		expect(sp).toHaveBeenCalledWith("wl-copy", [], {
			input: "wayland text",
			encoding: "utf-8",
		});
	});

	test("wl-copy fall through on Wayland when spawnSync throws", () => {
		process.env.WAYLAND_DISPLAY = "wayland-0";

		let callCount = 0;
		const result = copyToClipboard("xclip fallback", undefined, {
			spawnSync: mock((..._: any[]) => {
				callCount++;
				if (callCount === 1) throw new Error("no wl-copy");
				return {
					status: 0,
					stdout: Buffer.from(""),
					stderr: Buffer.from(""),
					pid: 0,
					output: [],
					signal: null,
				};
			}) as unknown as typeof import("node:child_process").spawnSync,
			platform: "linux",
		});
		expect(result.success).toBe(true);
		expect(result.method).toBe("xclip");
	});

	test("xclip on Linux X11 returns success", () => {
		delete process.env.WAYLAND_DISPLAY;

		const sp = successfulSpawn();
		const result = copyToClipboard("xclip text", undefined, { spawnSync: sp, platform: "linux" });
		expect(result.success).toBe(true);
		expect(result.method).toBe("xclip");
		expect(sp).toHaveBeenCalledWith("xclip", ["-selection", "clipboard"], {
			input: "xclip text",
			encoding: "utf-8",
		});
	});

	test("xclip fall through to xsel when xclip spawnSync throws", () => {
		delete process.env.WAYLAND_DISPLAY;

		let callCount = 0;
		const result = copyToClipboard("xsel text", undefined, {
			spawnSync: mock((..._: any[]) => {
				callCount++;
				if (callCount === 1) throw new Error("no xclip");
				return {
					status: 0,
					stdout: Buffer.from(""),
					stderr: Buffer.from(""),
					pid: 0,
					output: [],
					signal: null,
				};
			}) as unknown as typeof import("node:child_process").spawnSync,
			platform: "linux",
		});
		expect(result.success).toBe(true);
		expect(result.method).toBe("xsel");
	});

	test("xsel on Linux X11 returns success", () => {
		delete process.env.WAYLAND_DISPLAY;

		let callCount = 0;
		const result = copyToClipboard("xsel works", undefined, {
			spawnSync: mock((..._: any[]) => {
				callCount++;
				if (callCount === 1) throw new Error("no xclip");
				return {
					status: 0,
					stdout: Buffer.from(""),
					stderr: Buffer.from(""),
					pid: 0,
					output: [],
					signal: null,
				};
			}) as unknown as typeof import("node:child_process").spawnSync,
			platform: "linux",
		});
		expect(result.success).toBe(true);
		expect(result.method).toBe("xsel");
		expect(callCount).toBeGreaterThanOrEqual(2);
	});

	test("xclip non-zero status falls through to xsel", () => {
		delete process.env.WAYLAND_DISPLAY;

		let callCount = 0;
		const result = copyToClipboard("xsel fallback", undefined, {
			spawnSync: mock((..._: any[]) => {
				callCount++;
				if (callCount === 1)
					return {
						status: 1,
						stdout: Buffer.from(""),
						stderr: Buffer.from("xclip error"),
						pid: 0,
						output: [],
						signal: null,
					};
				return {
					status: 0,
					stdout: Buffer.from(""),
					stderr: Buffer.from(""),
					pid: 0,
					output: [],
					signal: null,
				};
			}) as unknown as typeof import("node:child_process").spawnSync,
			platform: "linux",
		});
		expect(result.success).toBe(true);
		expect(result.method).toBe("xsel");
	});

	test("fallback to temp file when all CLI methods fail", () => {
		// No spawnSync override -> no CLI methods -> file fallback with real fs

		const result = copyToClipboard("final fallback", undefined, { platform: "win32" });
		expect(result.success).toBe(true);
		expect(result.method).toBe("file");
		expect(result.filePath).toBeDefined();
		expect(result.filePath).toContain("airgent-copy-");
		// Verify the file was actually written
		const { existsSync, readFileSync } = require("node:fs");
		expect(existsSync(result.filePath!)).toBe(true);
		expect(readFileSync(result.filePath!, "utf-8")).toBe("final fallback");
		if (result.filePath) tempFiles.push(result.filePath);
	});

	test("file fallback reports error when writeFileSync throws", () => {
		const result = copyToClipboard("failing write", undefined, {
			spawnSync: throwingSpawn(),
			writeFileSync: mock((..._: any[]) => {
				throw new Error("disk full");
			}) as any,
			platform: "win32",
		});
		expect(result.success).toBe(false);
		expect(result.method).toBe("file");
		expect(result.error).toBeDefined();
		expect(result.error).toContain("disk full");
	});

	test("empty string is copied successfully", () => {
		delete process.env.WAYLAND_DISPLAY;

		const result = copyToClipboard("", undefined, {
			spawnSync: successfulSpawn(),
			platform: "linux",
		});
		expect(result.success).toBe(true);
		expect(result.method).toBe("xclip");
	});

	test("very long string is copied successfully", () => {
		const longText = "x".repeat(100_000);

		const sp = successfulSpawn();
		const result = copyToClipboard(longText, undefined, { spawnSync: sp, platform: "darwin" });
		expect(result.success).toBe(true);
		expect(result.method).toBe("pbcopy");
		expect(sp).toHaveBeenCalledWith("pbcopy", [], {
			input: longText,
			encoding: "utf-8",
		});
	});

	test("all methods fail returns false with method file", () => {
		const result = copyToClipboard("fail all", undefined, {
			spawnSync: throwingSpawn(),
			writeFileSync: mock((..._: any[]) => {
				throw new Error("permission denied");
			}) as any,
			platform: "linux",
		});
		expect(result.success).toBe(false);
		expect(result.method).toBe("file");
		expect(result.error).toBeDefined();
	});

	test("Wayland wl-copy non-zero status falls through to xclip", () => {
		process.env.WAYLAND_DISPLAY = "wayland-0";

		let callCount = 0;
		const result = copyToClipboard("wl-copy to xclip", undefined, {
			spawnSync: mock((..._: any[]) => {
				callCount++;
				if (callCount === 1)
					return {
						status: 1,
						stdout: Buffer.from(""),
						stderr: Buffer.from("wl-copy failed"),
						pid: 0,
						output: [],
						signal: null,
					};
				return {
					status: 0,
					stdout: Buffer.from(""),
					stderr: Buffer.from(""),
					pid: 0,
					output: [],
					signal: null,
				};
			}) as unknown as typeof import("node:child_process").spawnSync,
			platform: "linux",
		});
		expect(result.success).toBe(true);
		expect(result.method).toBe("xclip");
	});

	test("OSC52 with empty text returns success", () => {
		const osc52Fn = mock(() => true);

		const result = copyToClipboard("", osc52Fn);
		expect(result.success).toBe(true);
		expect(result.method).toBe("osc52");
	});

	test("no OSC52 callback skips OSC52 path", () => {
		// When no osc52Copy is passed, it goes straight to system clipboard
		const result = copyToClipboard("no osc52", undefined, {
			spawnSync: successfulSpawn(),
			platform: "darwin",
		});
		expect(result.success).toBe(true);
		expect(result.method).toBe("pbcopy");
	});

	test("file fallback method includes filePath in result", () => {
		const result = copyToClipboard("temp file test", undefined, { platform: "win32" });
		expect(result.success).toBe(true);
		expect(result.method).toBe("file");
		expect(result.filePath).toMatch(/airgent-copy-\d+\.txt$/);
		// Verify the file was actually written
		const { existsSync, readFileSync } = require("node:fs");
		expect(existsSync(result.filePath!)).toBe(true);
		expect(readFileSync(result.filePath!, "utf-8")).toBe("temp file test");
		if (result.filePath) tempFiles.push(result.filePath);
	});

	test("multiple consecutive calls work", () => {
		const sp = successfulSpawn();
		const r1 = copyToClipboard("first", undefined, { spawnSync: sp, platform: "darwin" });
		const r2 = copyToClipboard("second", undefined, { spawnSync: sp, platform: "darwin" });
		const r3 = copyToClipboard("third", undefined, { spawnSync: sp, platform: "darwin" });

		expect(r1.success).toBe(true);
		expect(r2.success).toBe(true);
		expect(r3.success).toBe(true);
		expect(sp).toHaveBeenCalledTimes(3);
	});
});
