#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// --- 1. Stub missing native packages ---
const stubs = [
  "@opentui/core-darwin-arm64",
  "@opentui/core-darwin-x64",
  "@opentui/core-win32-x64",
];
for (const name of stubs) {
  const dir = join("node_modules", name);
  if (existsSync(dir)) continue;
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name, version: "0.0.0", main: "index.js", type: "module" }, null, 2));
  writeFileSync(join(dir, "index.js"), 'export default "/dev/null";\n');
  console.log(`[setup-test-stubs] created stub: ${name}`);
}

// --- 2. Patch @opentui/core bundle chunk ---
// Use a marker so re-runs are idempotent regardless of what variant is present.
const chunkPath = join("node_modules", "@opentui", "core", "index-ysvpktsp.js");
const MARKER = "/* opentui-stub */";
const REPLACEMENT = MARKER + "\nvar nativePackage = { default: \"/dev/null\" };\nvar targetLibPath = \"/dev/null\";";

if (existsSync(chunkPath)) {
  let content = readFileSync(chunkPath, "utf8");
  if (content.includes(MARKER)) {
    console.log("[setup-test-stubs] @opentui/core chunk already patched");
  } else {
    const m = content.match(/(var nativePackage[\s\S]*?var targetLibPath = nativePackage\.default;)/);
    if (m) {
      content = content.replace(m[1], REPLACEMENT);
      writeFileSync(chunkPath, content, "utf8");
      console.log("[setup-test-stubs] patched @opentui/core chunk");
    } else {
      console.warn("[setup-test-stubs] WARNING: patch pattern not found — @opentui version may have changed");
    }
  }
}
