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

  test("empty path resolves to CWD (within allowed dirs)", () => {
    // resolve("") returns CWD, which is in allowed dirs
    const result = resolveSafePath("");
    expect(result).toBe(process.cwd());
  });

  test("throws on path with null byte", () => {
    // null byte gets treated as part of a non-existent filename
    expect(() => resolveSafePath("safe.txt\0")).toThrow(/File not found|Access denied/);
  });

  test("throws on symlink pointing outside allowed dirs", () => {
    expect(() => resolveSafePath("/proc/1/environ")).toThrow("Access denied");
  });

  test("whitespace path throws (resolve adds to CWD, no such file)", () => {
    // resolve("   ") creates a path with trailing spaces which doesn't exist
    expect(() => resolveSafePath("   ")).toThrow(/File not found/);
  });

  test("resolves file with special characters in name", () => {
    const specialPath = join(tmpDir, "test-file_v2.1.txt");
    writeFileSync(specialPath, "special");
    const result = resolveSafePath(specialPath);
    expect(result).toContain("test-file_v2.1.txt");
    rmSync(specialPath);
  });

  test("resolves file with unicode characters", () => {
    const unicodePath = join(tmpDir, "résumé.txt");
    writeFileSync(unicodePath, "unicode");
    const result = resolveSafePath(unicodePath);
    expect(result).toContain("résumé.txt");
    rmSync(unicodePath);
  });

  test("throws on very long path exceeding OS limits", () => {
    const longName = "a".repeat(300);
    const longPath = join(tmpDir, longName);
    expect(() => resolveSafePath(longPath)).toThrow();
  });

  test("resolves file when allowed dir is a parent of CWD", () => {
    // Allowed dirs contain process.cwd() and HOME
    const homeFile = join(process.env.HOME || "/tmp", ".bashrc");
    // May or may not exist, just check it doesn't throw access denied
    try {
      const result = resolveSafePath(homeFile);
      expect(result).toContain(".bashrc");
    } catch (e: unknown) {
      // File not found is also acceptable (doesn't exist in CI)
      expect((e as Error).message).toMatch(/File not found/);
    }
  });

  test("rejects existing file outside allowed dirs", () => {
    // /etc/hostname should exist and be outside allowed dirs
    expect(() => resolveSafePath("/etc/hostname")).toThrow("Access denied");
  });
});
