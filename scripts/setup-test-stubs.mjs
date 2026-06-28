#!/usr/bin/env node
// Creates stub native packages and patches @opentui/core bundle
// required for cross-platform testing.
//
// @opentui/core dynamically imports the platform-specific native binding
// via a top-level await in its bundle chunk. This executes before any
// mock.module() can intercept it, causing a ReferenceError on platforms
// where the native package is not installed (e.g. darwin-arm64).
//
// Fix: patch the chunk file to skip the dynamic import entirely.

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
  writeFileSync(join(dir, "package.json"), JSON.stringify({
    name,
    version: "0.0.0",
    main: "index.js",
    type: "module",
  }, null, 2));
  writeFileSync(join(dir, "index.js"), 'export default "/dev/null";\n');
  console.log(`[setup-test-stubs] created stub: ${name}`);
}

// --- 2. Patch @opentui/core bundle chunk ---
// The chunk file contains a top-level await that imports the native package.
// We replace it with a static stub to prevent ReferenceError on unsupported platforms.
const chunkPath = join("node_modules", "@opentui", "core", "index-ysvpktsp.js");

if (existsSync(chunkPath)) {
  let content = readFileSync(chunkPath, "utf8");
  const old = "var nativePackage = await import(`@opentui/core-${process.platform}-${process.arch}`);\nvar targetLibPath = nativePackage.default;";
  const patched = 'var nativePackage = { default: "/dev/null" };\nvar targetLibPath = "/dev/null";';

  if (content.includes(old)) {
    content = content.replace(old, patched);
    writeFileSync(chunkPath, content, "utf8");
    console.log("[setup-test-stubs] patched @opentui/core chunk");
  } else if (content.includes(patched)) {
    console.log("[setup-test-stubs] @opentui/core chunk already patched");
  } else {
    console.warn("[setup-test-stubs] WARNING: patch pattern not found in chunk — @opentui version may have changed");
  }
}
