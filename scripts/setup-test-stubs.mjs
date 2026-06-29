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
// On supported platforms (linux-x64) the dynamic import must be preserved so
// the real native library is loaded at runtime.  On platforms where no native
// package is installed (darwin, win32) we replace it with a /dev/null stub so
// the bundle does not throw a ReferenceError before any mock can intercept it.
const chunkPath = join("node_modules", "@opentui", "core", "index-ysvpktsp.js");

if (existsSync(chunkPath)) {
  let content = readFileSync(chunkPath, "utf8");

  const old = "var nativePackage = await import(`@opentui/core-${process.platform}-${process.arch}`);\nvar targetLibPath = nativePackage.default;";

  // Always stub the native package import to avoid top-level await issues
  // in bun test --isolate. The actual library path is set via setRenderLibPath()
  // at runtime in src/ui/index.ts for linux-x64.
  const patched =
    'var nativePackage = { default: "/dev/null" };\n' +
    'var targetLibPath = "/dev/null";';

  // Pattern left by the old (broken) patch that hardcoded /dev/null for all platforms.
  const brokenPatch = 'var nativePackage = { default: "/dev/null" };\nvar targetLibPath = "/dev/null";';
  // Pattern left by the ternary-based patch (also broken on some runtimes).
  const ternaryPatch = 'var nativePackage = (process.platform === "linux" && process.arch === "x64")';

  if (content.includes(old)) {
    content = content.replace(old, patched);
    writeFileSync(chunkPath, content, "utf8");
    console.log("[setup-test-stubs] patched @opentui/core chunk");
  } else if (content.includes(patched)) {
    console.log("[setup-test-stubs] @opentui/core chunk already patched");
  } else if (content.includes(brokenPatch)) {
    content = content.replace(brokenPatch, patched);
    writeFileSync(chunkPath, content, "utf8");
    console.log("[setup-test-stubs] re-patched @opentui/core chunk (replaced broken all-platform stub)");
  } else if (content.includes(ternaryPatch)) {
    // Replace the entire ternary block (3 lines) with the if-statement version.
    const ternaryBlock =
      'var nativePackage = (process.platform === "linux" && process.arch === "x64")\n' +
      '  ? await import(`@opentui/core-${process.platform}-${process.arch}`)\n' +
      '  : { default: "/dev/null" };\n' +
      'var targetLibPath = nativePackage.default;';
    content = content.replace(ternaryBlock, patched);
    writeFileSync(chunkPath, content, "utf8");
    console.log("[setup-test-stubs] re-patched @opentui/core chunk (replaced ternary with if-statement)");
  } else {
    console.warn("[setup-test-stubs] WARNING: patch pattern not found in chunk — @opentui version may have changed");
  }
}
