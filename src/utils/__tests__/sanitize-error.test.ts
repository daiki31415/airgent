import { describe, expect, test } from "bun:test";
import { sanitizeError } from "../logger";

describe("sanitizeError", () => {
  test("extracts message from Error object", () => {
    const result = sanitizeError(new Error("Something broke"));
    expect(result).toBe("Something broke");
  });

  test("strips stack traces", () => {
    const err = new Error("Top level\n    at foo (bar.ts:10)\n    at baz (qux.ts:20)");
    const result = sanitizeError(err);
    expect(result).toBe("Top level");
    expect(result).not.toContain("at foo");
  });

  test("converts non-Error to string", () => {
    expect(sanitizeError("just a string")).toBe("just a string");
    expect(sanitizeError(42)).toBe("42");
    expect(sanitizeError(null)).toBe("null");
  });

  test("caps length at 500 chars", () => {
    const long = "x".repeat(1000);
    const result = sanitizeError(long);
    expect(result.length).toBe(503); // 500 + "..."
    expect(result.endsWith("...")).toBe(true);
  });

  test("handles empty string", () => {
    expect(sanitizeError("")).toBe("");
  });

  test("handles undefined", () => {
    expect(sanitizeError(undefined)).toBe("undefined");
  });

  test("handles Error without message", () => {
    const err = new Error();
    const result = sanitizeError(err);
    expect(typeof result).toBe("string");
  });
});
