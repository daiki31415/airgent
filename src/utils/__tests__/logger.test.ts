import { describe, expect, test } from "bun:test";
import { Logger, sanitizeError } from "../logger";

describe("Logger", () => {
  test("creates child logger with compound name", () => {
    const parent = new Logger("airgent", "info");
    const child = parent.child("config");
    expect((child as any).name).toBe("airgent:config");
  });

  test("child inherits log level from parent", () => {
    const parent = new Logger("p", "error");
    const child = parent.child("c");
    expect((child as any).level).toBe("error");
  });

  test("child inherits debug mode from parent", () => {
    const parent = new Logger("p", "info", true);
    const child = parent.child("c");
    expect((child as any).debugMode).toBe(true);
  });

  test("setDebug toggles debug mode", () => {
    const log = new Logger("test", "debug", false);
    expect((log as any).debugMode).toBe(false);
    log.setDebug(true);
    expect((log as any).debugMode).toBe(true);
  });
});

describe("sanitizeError", () => {
  test("extracts message from Error", () => {
    const result = sanitizeError(new Error("something broke"));
    expect(result).toBe("something broke");
  });

  test("strips stack trace lines", () => {
    const err = new Error("first line\n    at Object.<anonymous> (/file.ts:1:1)\n    at processTicksAndRejections");
    const result = sanitizeError(err);
    expect(result).toBe("first line");
    expect(result).not.toContain("at Object");
  });

  test("converts non-Error to string", () => {
    expect(sanitizeError("string error")).toBe("string error");
    expect(sanitizeError(42)).toBe("42");
    expect(sanitizeError(null)).toBe("null");
    expect(sanitizeError(undefined)).toBe("undefined");
  });

  test("caps length at 500 chars with ellipsis", () => {
    const long = "x".repeat(600);
    const result = sanitizeError(long);
    expect(result.length).toBe(503);
    expect(result.endsWith("...")).toBe(true);
  });

  test("does not add ellipsis for under-500 strings", () => {
    const short = "short error";
    expect(sanitizeError(short)).toBe(short);
  });

  test("handles empty string", () => {
    expect(sanitizeError("")).toBe("");
  });

  test("redacts home directory path when HOME is set", () => {
    // HOME_DIR is captured at module import time, so test works with actual HOME
    const home = process.env.HOME;
    if (home) {
      const result = sanitizeError(`Error at ${home}/project/file.ts`);
      expect(result).toContain("~/project/file.ts");
      expect(result).not.toContain(home);
    }
  });

  test("handles Error with no message", () => {
    const err = new Error();
    const result = sanitizeError(err);
    expect(result).toBe("");
  });
});

describe("Logger extended", () => {
  test("setDebug enables debug mode", () => {
    const log = new Logger("test", "info", false);
    log.setDebug(true);
    expect((log as any).debugMode).toBe(true);
  });

  test("setDebug disables debug mode", () => {
    const log = new Logger("test", "info", true);
    log.setDebug(false);
    expect((log as any).debugMode).toBe(false);
  });

  test("child creates child logger with compound name", () => {
    const parent = new Logger("app", "info");
    const child = parent.child("db");
    expect((child as any).name).toBe("app:db");
  });

  test("child inherits level from parent", () => {
    const parent = new Logger("app", "error");
    const child = parent.child("net");
    expect((child as any).level).toBe("error");
  });

  test("child inherits debugMode from parent", () => {
    const parent = new Logger("app", "debug", true);
    const child = parent.child("cache");
    expect((child as any).debugMode).toBe(true);
  });

  test("multiple child loggers from same parent", () => {
    const parent = new Logger("app", "info");
    const c1 = parent.child("mod1");
    const c2 = parent.child("mod2");
    expect((c1 as any).name).toBe("app:mod1");
    expect((c2 as any).name).toBe("app:mod2");
  });

  test("child logger can have its own child", () => {
    const parent = new Logger("app", "info");
    const child = parent.child("sub");
    const grandchild = child.child("deep");
    expect((grandchild as any).name).toBe("app:sub:deep");
  });

  test("debug does not log when debugMode is false", () => {
    // Mock console.debug
    const originalDebug = console.debug;
    console.debug = (() => {}) as typeof console.debug;
    let debugCalled = false;
    console.debug = () => { debugCalled = true; };

    const log = new Logger("test", "debug", false);
    log.debug("should not show");
    expect(debugCalled).toBe(false);

    console.debug = originalDebug;
  });

  test("debug logs when debugMode is true", () => {
    const originalDebug = console.debug;
    let debugCalled = false;
    console.debug = () => { debugCalled = true; };

    const log = new Logger("test", "debug", true);
    log.debug("debug message");
    expect(debugCalled).toBe(true);

    console.debug = originalDebug;
  });

  test("info respects level filtering (warn should not show info)", () => {
    const originalLog = console.log;
    let logCalled = false;
    console.log = () => { logCalled = true; };

    const log = new Logger("test", "warn");
    log.info("should be filtered out");
    expect(logCalled).toBe(false);

    console.log = originalLog;
  });

  test("error and fatal use console.error", () => {
    const originalError = console.error;
    let errorCalled = false;
    console.error = () => { errorCalled = true; };

    const log = new Logger("test", "error");
    log.error("error message");
    expect(errorCalled).toBe(true);

    errorCalled = false;
    log.fatal("fatal message");
    expect(errorCalled).toBe(true);

    console.error = originalError;
  });

  test("sanitizeError with nested Error objects", () => {
    const inner = new Error("inner failure");
    const outer = new Error("outer: " + inner.message);
    const result = sanitizeError(outer);
    expect(result).toContain("outer: inner failure");
    expect(result).not.toContain("at ");
  });

  test("sanitizeError with very long first line truncates", () => {
    const longLine = "a".repeat(600) + "\nstack line";
    const result = sanitizeError(longLine);
    expect(result.length).toBe(503);
    expect(result.endsWith("...")).toBe(true);
  });

  test("sanitizeError with special characters in path", () => {
    const result = sanitizeError("Error at /home/user/[project]/file.ts");
    expect(result).toBeTruthy();
  });

  test("sanitizeError with object that has custom toString", () => {
    const obj = { toString: () => "custom error message" };
    const result = sanitizeError(obj);
    expect(result).toBe("custom error message");
  });
});
