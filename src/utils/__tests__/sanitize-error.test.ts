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

  test("redacts home directory paths", () => {
    const result = sanitizeError(new Error("Error at /home/daiki/project/src/file.ts:10"));
    expect(result).toContain("~/project/src/file.ts:10");
    expect(result).not.toContain("/home/daiki");
  });

  test("redacts multiple home directory occurrences", () => {
    const result = sanitizeError(new Error("paths: /home/daiki/a, /home/daiki/b"));
    expect(result).toContain("~/a, ~/b");
    expect((result.match(/~/g) || []).length).toBe(2);
  });

  test("handles exactly 500 char boundary", () => {
    const msg = "a".repeat(500);
    const result = sanitizeError(msg);
    expect(result.length).toBe(500);
    expect(result).not.toContain("...");
  });

  test("handles 501 chars with triple-dot truncation", () => {
    const msg = "a".repeat(501);
    const result = sanitizeError(msg);
    expect(result.length).toBe(503);
    expect(result.endsWith("...")).toBe(true);
  });

  test("handles number 0", () => {
    expect(sanitizeError(0)).toBe("0");
  });

  test("handles boolean false", () => {
    expect(sanitizeError(false)).toBe("false");
  });
});
