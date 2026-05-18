import { describe, expect, test } from "bun:test";
import { CompressionManager } from "../index";
import type { AgentMessage } from "../../types";

function createManager(): CompressionManager {
  return new CompressionManager(null as any, null as any);
}

describe("CompressionManager.compress", () => {
  test("extracts topics from headers", async () => {
    const mgr = createManager();
    const msgs: AgentMessage[] = [
      { id: "1", role: "user", content: "# Auth System\nImplement login", timestamp: 0 },
      { id: "2", role: "assistant", content: "## Setup\nCreated auth route", timestamp: 0 },
    ];
    const entry = await mgr.compress(msgs);
    expect(entry.topics).toContain("Auth System");
    expect(entry.topics).toContain("Setup");
  });

  test("extracts file paths from content", async () => {
    const mgr = createManager();
    const msgs: AgentMessage[] = [
      { id: "1", role: "user", content: "Edit src/auth.rs and src/config.go and src/main.py", timestamp: 0 },
    ];
    const entry = await mgr.compress(msgs);
    expect(entry.files).toContain("src/auth.rs");
    expect(entry.files).toContain("src/config.go");
    expect(entry.files).toContain("src/main.py");
  });

  test("extracts error keywords", async () => {
    const mgr = createManager();
    const msgs: AgentMessage[] = [
      { id: "1", role: "user", content: "Got TypeError: cannot read property", timestamp: 0 },
    ];
    const entry = await mgr.compress(msgs);
    expect(entry.errorKeywords).toContain("TypeError");
  });

  test("extracts commands", async () => {
    const mgr = createManager();
    const msgs: AgentMessage[] = [
      { id: "1", role: "user", content: "Run $ npm install\nThen $ bun test", timestamp: 0 },
    ];
    const entry = await mgr.compress(msgs);
    expect(entry.commands).toContain("npm install");
    expect(entry.commands).toContain("bun test");
  });

  test("extracts PascalCase entities", async () => {
    const mgr = createManager();
    const msgs: AgentMessage[] = [
      { id: "1", role: "user", content: "AuthManager handles UserLoginFlow", timestamp: 0 },
    ];
    const entry = await mgr.compress(msgs);
    expect(entry.entities).toContain("AuthManager");
    expect(entry.entities).toContain("UserLoginFlow");
  });

  test("calculates importance score based on metadata", async () => {
    const mgr = createManager();
    const msgs: AgentMessage[] = [
      { id: "1", role: "user", content: "# Critical Bug\nTypeError in src/app.ts\n$ git revert\nSee ErrorManager", timestamp: 0 },
    ];
    const entry = await mgr.compress(msgs);
    expect(entry.importanceScore).toBeGreaterThan(0.3);
    expect(entry.importanceScore).toBeLessThanOrEqual(1.0);
  });

  test("truncates content over 1000 chars", async () => {
    const mgr = createManager();
    const longContent = "x".repeat(2000);
    const msgs: AgentMessage[] = [
      { id: "1", role: "user", content: longContent, timestamp: 0 },
    ];
    const entry = await mgr.compress(msgs);
    expect(entry.compressedContent.endsWith("...[truncated]")).toBe(true);
  });

  test("keeps content under 1000 chars as-is", async () => {
    const mgr = createManager();
    const shortContent = "short message";
    const msgs: AgentMessage[] = [
      { id: "1", role: "user", content: shortContent, timestamp: 0 },
    ];
    const entry = await mgr.compress(msgs);
    expect(entry.compressedContent).toBe("[user]\nshort message");
  });

  test("combines multiple messages with role headers", async () => {
    const mgr = createManager();
    const msgs: AgentMessage[] = [
      { id: "1", role: "user", content: "hello", timestamp: 0 },
      { id: "2", role: "assistant", content: "world", timestamp: 0 },
    ];
    const entry = await mgr.compress(msgs);
    const combined = "[user]\nhello\n\n[assistant]\nworld";
    expect(entry.compressedContent).toBe(combined);
  });

  test("baseline importance for empty metadata", async () => {
    const mgr = createManager();
    const msgs: AgentMessage[] = [
      { id: "1", role: "user", content: "hello world", timestamp: 0 },
    ];
    const entry = await mgr.compress(msgs);
    expect(entry.importanceScore).toBe(0.3);
  });

  test("errors boost importance significantly", async () => {
    const mgr = createManager();
    const msgs: AgentMessage[] = [
      { id: "1", role: "user", content: "Error: TypeError\nSyntaxError\nReferenceError", timestamp: 0 },
    ];
    const entry = await mgr.compress(msgs);
    // baseline 0.3 + errors capped at 0.3 + 3 entities * 0.02 = 0.06
    expect(entry.importanceScore).toBeGreaterThanOrEqual(0.3);
    expect(entry.importanceScore).toBeGreaterThan(0.5);
    expect(entry.errorKeywords).toContain("TypeError");
    expect(entry.errorKeywords).toContain("SyntaxError");
    expect(entry.errorKeywords).toContain("ReferenceError");
  });
});
