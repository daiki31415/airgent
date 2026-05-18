import { beforeAll, afterAll, describe, expect, test } from "bun:test";
import { resolveSafePath } from "../smart-cat";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

describe("resolveSafePath", () => {
  const tmpDir = join(import.meta.dir, "..", "__test_tmp__");

  beforeAll(() => {
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(join(tmpDir, "safe.txt"), "safe content");
    writeFileSync(join(tmpDir, "sub_file.txt"), "sub content");
    mkdirSync(join(tmpDir, "subdir"), { recursive: true });
    writeFileSync(join(tmpDir, "subdir", "nested.txt"), "nested");
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("resolves existing file within allowed dir", () => {
    const result = resolveSafePath(join(tmpDir, "safe.txt"));
    expect(result).toContain("safe.txt");
  });

  test("throws on non-existent file", () => {
    expect(() => resolveSafePath(join(tmpDir, "nonexistent.txt"))).toThrow("File not found");
  });

  test("throws on path traversal attempt", () => {
    expect(() => resolveSafePath("/etc/passwd")).toThrow("Access denied");
  });

  test("resolves file in subdirectory", () => {
    const result = resolveSafePath(join(tmpDir, "subdir", "nested.txt"));
    expect(result).toContain("nested.txt");
  });

  test("throws on traversal via ../ beyond allowed dirs", () => {
    expect(() => resolveSafePath(join(tmpDir, "..", "safe.txt"))).toThrow(/Access denied|File not found/);
  });

  test("throws on absolute path pointing outside allowed dirs", () => {
    expect(() => resolveSafePath("/etc/hostname")).toThrow("Access denied");
  });

  test("resolves file within HOME directory", () => {
    const homePath = join(process.env.HOME || "/home/daiki", "test-allowed.txt");
    try { writeFileSync(homePath, "home test"); } catch {}
    try {
      const result = resolveSafePath(homePath);
      expect(result).toContain("test-allowed.txt");
    } finally {
      try { rmSync(homePath); } catch {}
    }
  });

  test("rejects file with same name as allowed dir root but different path", () => {
    // Allowed dirs contain process.cwd() - test a sibling
    const parent = join(tmpDir, "..");
    expect(() => resolveSafePath(join(parent, "nonexistent.txt"))).toThrow();
  });

  test("normalizes mixed slashes", () => {
    const result = resolveSafePath(tmpDir + "/./subdir/../subdir/nested.txt");
    expect(result).toContain("nested.txt");
  });

  test("resolves path with trailing dot", () => {
    const result = resolveSafePath(tmpDir + "/./safe.txt");
    expect(result).toContain("safe.txt");
  });
});
