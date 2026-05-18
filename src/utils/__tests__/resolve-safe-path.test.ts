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
});
