import { describe, expect, test } from "bun:test";
import { sanitizeError } from "../logger";

describe("sanitizeError", () => {
	test("extracts message from Error object", () => {
		const result = sanitizeError(new Error("Something broke"));
		expect(result).toBe("Something broke");
	});

	test("strips stack traces", () => {
		const err = new Error(
			"Top level\n    at foo (bar.ts:10)\n    at baz (qux.ts:20)",
		);
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
		const home = process.env.HOME || "/home/user";
		const result = sanitizeError(
			new Error(`Error at ${home}/project/src/file.ts:10`),
		);
		expect(result).toContain("~/project/src/file.ts:10");
		expect(result).not.toContain(home);
	});

	test("redacts multiple home directory occurrences", () => {
		const home = process.env.HOME || "/home/user";
		const result = sanitizeError(new Error(`paths: ${home}/a, ${home}/b`));
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

	test("strips multiple newlines from Error message", () => {
		const err = new Error("line1\nline2\nline3\nline4");
		const result = sanitizeError(err);
		expect(result).toBe("line1");
	});

	test("handles Error with only stack and no message", () => {
		const err = new Error();
		err.stack = "Error\n    at foo (bar.ts:1)";
		const result = sanitizeError(err);
		// Error.message is empty string when no message passed
		expect(result).toBe("");
	});

	test("redacts multiple distinct HOME paths", () => {
		const home = process.env.HOME || "/home/user";
		const msg = `Error at ${home}/a and ${home}/b`;
		const result = sanitizeError(msg);
		expect(result).toContain("~/a and ~/b");
	});

	test("handles Array as error", () => {
		const result = sanitizeError(["err1", "err2"]);
		expect(result).toBe("err1,err2");
	});

	test("handles plain object as error", () => {
		const result = sanitizeError({ message: "custom" });
		expect(result).toBe("[object Object]");
	});

	test("handles Error with special regex chars in message", () => {
		const err = new Error("Error at /home/user/path+with[special]chars$");
		const result = sanitizeError(err);
		expect(result).toBeDefined();
	});

	test("does not modify safe short messages", () => {
		const msg = "simple error";
		const result = sanitizeError(msg);
		expect(result).toBe(msg);
	});

	test("handles very long error with existing newlines truncates to first line", () => {
		const longWithNewlines = `short first line\n${"b".repeat(600)}`;
		const result = sanitizeError(longWithNewlines);
		expect(result).toBe("short first line");
	});

	test("handles Error with multi-byte unicode characters", () => {
		const err = new Error("エラーが発生しました: something broke");
		const result = sanitizeError(err);
		expect(result).toContain("エラー");
	});
});
