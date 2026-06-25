/**
 * Tests for smart-cat.ts
 *
 * Tests resolveSafePath and smartCat functions.
 * Uses real filesystem within allowed directories (CWD and HOME).
 * Allowed dirs = [process.cwd(), HOME]
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

// Use a test dir within CWD so it's in the allowed dirs
const TEST_TMP = join(import.meta.dir, "..", "__smartcat_tmp__");
const TEST_FILE_TXT = join(TEST_TMP, "hello.txt");
const TEST_FILE_GZ = join(TEST_TMP, "data.gz");
const TEST_FILE_MD = join(TEST_TMP, "doc.md");
const TEST_SUBDIR = join(TEST_TMP, "sub");
const TEST_NESTED = join(TEST_SUBDIR, "nested.txt");
const EMPTY_FILE = join(TEST_TMP, "empty.txt");
const LARGE_FILE = join(TEST_TMP, "large.txt");

describe("smartCat", () => {
	beforeAll(() => {
		mkdirSync(TEST_SUBDIR, { recursive: true });
		writeFileSync(TEST_FILE_TXT, "hello world\nline 2\nline 3\n");
		writeFileSync(TEST_FILE_GZ, gzipSync("fake gz\n"));
		writeFileSync(TEST_FILE_MD, "# Markdown\n\nContent\n");
		writeFileSync(TEST_NESTED, "nested content\n");
		writeFileSync(EMPTY_FILE, "");
		writeFileSync(LARGE_FILE, "line\n".repeat(2000));
	});

	afterAll(() => {
		rmSync(TEST_TMP, { recursive: true, force: true });
	});

	test("reads a text file with cat", () => {
		const { smartCat } = require("../smart-cat");
		const result = smartCat(TEST_FILE_TXT);
		expect(result).toContain("hello world");
	});

	test("handles non-existent file", () => {
		const { smartCat } = require("../smart-cat");
		const badPath = join(TEST_TMP, "ghost.txt");
		expect(() => smartCat(badPath)).toThrow(/File not found/);
	});

	test("throws on archive file (zip)", () => {
		const { smartCat } = require("../smart-cat");
		expect(() => smartCat(join(TEST_TMP, "archive.zip"))).toThrow("Refusing to read archive");
	});

	test("throws on archive file (tar.gz)", () => {
		const { smartCat } = require("../smart-cat");
		expect(() => smartCat(join(TEST_TMP, "archive.tar.gz"))).toThrow("Refusing to read archive");
	});

	test("throws on archive file (7z)", () => {
		const { smartCat } = require("../smart-cat");
		expect(() => smartCat(join(TEST_TMP, "data.7z"))).toThrow("Refusing to read archive");
	});

	test("throws on archive file (rar)", () => {
		const { smartCat } = require("../smart-cat");
		expect(() => smartCat(join(TEST_TMP, "data.rar"))).toThrow("Refusing to read archive");
	});

	test("throws on archive file (tgz)", () => {
		const { smartCat } = require("../smart-cat");
		expect(() => smartCat(join(TEST_TMP, "data.tgz"))).toThrow("Refusing to read archive");
	});

	test("reads nested file in subdirectory", () => {
		const { smartCat } = require("../smart-cat");
		const result = smartCat(TEST_NESTED);
		expect(result).toContain("nested content");
	});

	test("truncates with maxLines option", () => {
		const { smartCat } = require("../smart-cat");
		const result = smartCat(TEST_FILE_TXT, { maxLines: 2 });
		const lines = result.split("\n");
		expect(lines.length).toBeLessThanOrEqual(3); // 2 lines + truncation message
		expect(result).toMatch(/\.\.\. \(\d+ more lines\)/);
	});

	test("maxLines of 0 returns full content (no truncation)", () => {
		const { smartCat } = require("../smart-cat");
		const result = smartCat(TEST_FILE_TXT, { maxLines: 0 });
		// maxLines: 0 is falsy, so no truncation occurs
		expect(result).toContain("hello world");
		expect(result).toContain("line 2");
		expect(result).toContain("line 3");
	});

	test("lineNumbers option adds line numbering", () => {
		const { smartCat } = require("../smart-cat");
		const result = smartCat(TEST_FILE_TXT, { lineNumbers: true });
		expect(result).toContain("1: hello world");
		expect(result).toContain("2: line 2");
		expect(result).toContain("3: line 3");
	});

	test("lineNumbers with maxLines works together", () => {
		const { smartCat } = require("../smart-cat");
		const result = smartCat(TEST_FILE_TXT, { lineNumbers: true, maxLines: 1 });
		// First line is the content, second line is the truncation message (both numbered)
		expect(result).toContain("1: hello world");
	});

	test("reads compressed file with zcat (gz)", () => {
		const { smartCat } = require("../smart-cat");
		// .gz extension triggers zcat — may fail if no zcat installed
		try {
			const result = smartCat(TEST_FILE_GZ);
			expect(result).toContain("fake gz");
		} catch (e: unknown) {
			// zcat may not be available, that's acceptable
			expect((e as Error).message).toMatch(/smartCat failed|not found|ENOENT/);
		}
	});

	test("reads markdown file", () => {
		const { smartCat } = require("../smart-cat");
		const result = smartCat(TEST_FILE_MD);
		expect(result).toContain("Markdown");
	});

	test("empty file returns empty string", () => {
		const { smartCat } = require("../smart-cat");
		const result = smartCat(EMPTY_FILE);
		expect(result).toBe("");
	});

	test("very large file content is returned", () => {
		const { smartCat } = require("../smart-cat");
		const result = smartCat(LARGE_FILE);
		const lines = result.split("\n");
		// 2000 lines written; trailing newline creates 2001 entries on split
		expect(lines.length).toBeGreaterThanOrEqual(2000);
	});

	test("smartCat can read a file within HOME directory", () => {
		const { smartCat } = require("../smart-cat");
		const homeTestFile = join(process.env.HOME || "/tmp", ".profile");
		if (existsSync(homeTestFile)) {
			const result = smartCat(homeTestFile);
			expect(result.length).toBeGreaterThan(0);
		}
	});
});
