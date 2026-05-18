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
