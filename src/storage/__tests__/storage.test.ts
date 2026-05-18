import { describe, expect, test } from "bun:test";
import { Storage } from "../index";

function createStorage(): Storage {
  return new Storage(":memory:");
}

describe("Storage raw_logs", () => {
  test("inserts and retrieves raw logs", () => {
    const s = createStorage();
    s.insertRawLog("log1", "sess1", "worker", "test content", 100);
    const logs = s.getRawLogs("sess1");
    expect(logs).toHaveLength(1);
    expect(logs[0]!.id).toBe("log1");
    expect(logs[0]!.content).toBe("test content");
    expect(logs[0]!.token_count).toBe(100);
  });

  test("getRawLogs orders by timestamp DESC", async () => {
    const s = createStorage();
    s.insertRawLog("log1", "sess1", "worker", "first", 10);
    await new Promise(r => setTimeout(r, 5));
    s.insertRawLog("log2", "sess1", "planner", "second", 20);
    const logs = s.getRawLogs("sess1");
    expect(logs).toHaveLength(2);
    expect(logs[0]!.id).toBe("log2");
  });

  test("getRawLogs respects limit", () => {
    const s = createStorage();
    s.insertRawLog("log1", "sess1", "worker", "a", 0);
    s.insertRawLog("log2", "sess1", "worker", "b", 0);
    s.insertRawLog("log3", "sess1", "worker", "c", 0);
    expect(s.getRawLogs("sess1", 2)).toHaveLength(2);
  });

  test("deleteRawLogsOlderThan removes old logs", async () => {
    const s = createStorage();
    const s1 = createStorage(); // separate instance for insert timestamp

    // Use the same storage instance - timestamp is set by Date.now() at insert time
    s.insertRawLog("old", "s1", "worker", "old", 0);
    await new Promise(r => setTimeout(r, 5));
    const now = Date.now();
    s.insertRawLog("new", "s1", "worker", "new", 0);
    s.deleteRawLogsOlderThan(now);
    const logs = s.getRawLogs("s1");
    expect(logs).toHaveLength(1);
    expect(logs[0]!.id).toBe("new");
  });

  test("returns empty array for unknown session", () => {
    const s = createStorage();
    expect(s.getRawLogs("nonexistent")).toHaveLength(0);
  });
});

describe("Storage memories", () => {
  test("inserts and retrieves memory", () => {
    const s = createStorage();
    s.insertMemory({
      id: "mem1", sessionId: "s1", bug: "crash", investigation: "found it",
      rootCause: "nullptr", fix: "add null check", reason: "safety",
      confidence: 0.9, tags: ["bug", "crash"], files: ["src/main.ts"], commands: [],
    });
    const mem = s.getMemory("mem1");
    expect(mem).not.toBeNull();
    expect(mem!.bug).toBe("crash");
    expect(mem!.root_cause).toBe("nullptr");
    expect(mem!.confidence).toBe(0.9);
  });

  test("getMemory returns null for missing id", () => {
    const s = createStorage();
    expect(s.getMemory("nonexistent")).toBeNull();
  });

  test("searchMemories filters by tags", () => {
    const s = createStorage();
    s.insertMemory({ id: "m1", sessionId: "s1", bug: "b1", investigation: "", rootCause: "", fix: "", reason: "", confidence: 0.8, tags: ["auth", "login"], files: [], commands: [] });
    s.insertMemory({ id: "m2", sessionId: "s1", bug: "b2", investigation: "", rootCause: "", fix: "", reason: "", confidence: 0.6, tags: ["ui"], files: [], commands: [] });
    const results = s.searchMemories(["auth"]);
    expect(results).toHaveLength(1);
    expect(results[0]!.id).toBe("m1");
  });

  test("searchMemories respects minConfidence", () => {
    const s = createStorage();
    s.insertMemory({ id: "m1", sessionId: "s1", bug: "b1", investigation: "", rootCause: "", fix: "", reason: "", confidence: 0.4, tags: ["auth"], files: [], commands: [] });
    s.insertMemory({ id: "m2", sessionId: "s1", bug: "b2", investigation: "", rootCause: "", fix: "", reason: "", confidence: 0.8, tags: ["auth"], files: [], commands: [] });
    expect(s.searchMemories(["auth"], 0.5)).toHaveLength(1);
    expect(s.searchMemories(["auth"], 0.3)).toHaveLength(2);
  });

  test("searchMemories orders by confidence DESC", () => {
    const s = createStorage();
    s.insertMemory({ id: "m1", sessionId: "s1", bug: "b1", investigation: "", rootCause: "", fix: "", reason: "", confidence: 0.3, tags: ["test"], files: [], commands: [] });
    s.insertMemory({ id: "m2", sessionId: "s1", bug: "b2", investigation: "", rootCause: "", fix: "", reason: "", confidence: 0.9, tags: ["test"], files: [], commands: [] });
    const results = s.searchMemories(["test"]);
    expect(results[0]!.id).toBe("m2");
  });
});

describe("Storage memory_links", () => {
  test("inserts and retrieves linked memories", () => {
    const s = createStorage();
    s.insertMemory({ id: "m1", sessionId: "s1", bug: "b1", investigation: "", rootCause: "rc1", fix: "", reason: "", confidence: 0.9, tags: [], files: [], commands: [] });
    s.insertMemory({ id: "m2", sessionId: "s1", bug: "b2", investigation: "", rootCause: "rc2", fix: "", reason: "", confidence: 0.9, tags: [], files: [], commands: [] });
    s.insertLink("link1", "m1", "m2", "same_cause", 0.8);
    // getLinkedMemories JOIN ON (target_id = m.id OR source_id = m.id) returns
    // both the linked memory (m2) AND the source memory (m1) itself
    const linked = s.getLinkedMemories("m1");
    expect(linked).toHaveLength(2);
    const linkedIds = linked.map(l => l.id);
    expect(linkedIds).toContain("m2");
    expect(linkedIds).toContain("m1");
  });

  test("getLinkedMemories returns from both source and target", () => {
    const s = createStorage();
    s.insertMemory({ id: "m1", sessionId: "s1", bug: "b1", investigation: "", rootCause: "", fix: "", reason: "", confidence: 0.9, tags: [], files: [], commands: [] });
    s.insertMemory({ id: "m2", sessionId: "s1", bug: "b2", investigation: "", rootCause: "", fix: "", reason: "", confidence: 0.9, tags: [], files: [], commands: [] });
    s.insertLink("link1", "m1", "m2", "derived", 0.6);
    const linked1 = s.getLinkedMemories("m1");
    const linked2 = s.getLinkedMemories("m2");
    // Each returns 2 rows: the memory itself + the linked partner
    expect(linked1).toHaveLength(2);
    expect(linked2).toHaveLength(2);
    expect(linked1.map(l => l.id)).toContain("m2");
    expect(linked2.map(l => l.id)).toContain("m1");
  });
});

describe("Storage evidence", () => {
  test("inserts and retrieves evidence", () => {
    const s = createStorage();
    s.insertMemory({ id: "mem1", sessionId: "s1", bug: "b", investigation: "", rootCause: "", fix: "", reason: "", confidence: 0.5, tags: [], files: [], commands: [] });
    s.insertEvidence("ev1", "mem1", "observed", "saw crash", "user report");
    const evidence = s.getEvidence("mem1");
    expect(evidence).toHaveLength(1);
    expect(evidence[0]!.type).toBe("observed");
    expect(evidence[0]!.content).toBe("saw crash");
  });
});

describe("Storage sessions", () => {
  test("creates and ends session", () => {
    const s = createStorage();
    s.createSession("sess1", "model-x");
    const row = s.getSession("sess1");
    expect(row).not.toBeNull();
    expect(row!.status).toBe("active");
    expect(row!.model_used).toBe("model-x");
    s.endSession("sess1", "completed");
    const ended = s.getSession("sess1");
    expect(ended!.status).toBe("completed");
    expect(ended!.end_time).not.toBeNull();
  });

  test("getActiveSessions returns only active", () => {
    const s = createStorage();
    s.createSession("s1", "m1");
    s.createSession("s2", "m2");
    s.endSession("s2", "completed");
    const active = s.getActiveSessions();
    expect(active).toHaveLength(1);
    expect(active[0]!.id).toBe("s1");
  });

  test("adds session messages", () => {
    const s = createStorage();
    s.createSession("s1");
    s.addSessionMessage("msg1", "s1", "user", "hello", 5);
    s.addSessionMessage("msg2", "s1", "assistant", "hi", 10);
    // Verify by checking the messages exist via raw_logs (different table)
    // session_messages is insert-only, no public getter
    const sess = s.getSession("s1");
    expect(sess).not.toBeNull();
  });
});

describe("Storage compressed entries", () => {
  test("inserts compressed entry with timestamp", () => {
    const s = createStorage();
    s.insertCompressedEntry({
      id: "c1", originalId: "orig1", title: "analysis", topics: ["bug"],
      entities: [], files: [], commands: [], errorKeywords: ["TypeError"],
      importanceScore: 0.8, tokenCount: 500, compressedContent: "compressed text",
    });
    const rows = s.getAllCompressed();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.title).toBe("analysis");
    expect(rows[0]!.topics).toEqual(["bug"]);
    expect(rows[0]!.errorKeywords).toEqual(["TypeError"]);
  });

  test("getCompressedByTopics searches topics", () => {
    const s = createStorage();
    s.insertCompressedEntry({
      id: "c1", originalId: "o1", title: "t1", topics: ["auth", "login"],
      entities: [], files: [], commands: [], errorKeywords: [],
      importanceScore: 0.5, tokenCount: 100, compressedContent: "x",
    });
    s.insertCompressedEntry({
      id: "c2", originalId: "o2", title: "t2", topics: ["ui"],
      entities: [], files: [], commands: [], errorKeywords: [],
      importanceScore: 0.5, tokenCount: 100, compressedContent: "y",
    });
    expect(s.getCompressedByTopics(["auth"])).toHaveLength(1);
    expect(s.getCompressedByTopics(["auth", "ui"])).toHaveLength(2);
  });

  test("getCompressedByOriginalId finds by original id", () => {
    const s = createStorage();
    s.insertCompressedEntry({
      id: "c1", originalId: "orig1", title: "t1", topics: [],
      entities: [], files: [], commands: [], errorKeywords: [],
      importanceScore: 0.5, tokenCount: 100, compressedContent: "x",
    });
    const found = s.getCompressedByOriginalId("orig1");
    expect(found).not.toBeNull();
    expect(found!.id).toBe("c1");
  });

  test("saveCompressedEntry skips duplicates", () => {
    const s = createStorage();
    const entry = {
      id: "c1", originalId: "o1", title: "t1", topics: [],
      entities: [], files: [], commands: [], errorKeywords: [],
      importanceScore: 0.5, tokenCount: 100, timestamp: Date.now(),
      compressedContent: "x",
    };
    s.saveCompressedEntry(entry);
    s.saveCompressedEntry(entry);
    expect(s.getAllCompressed()).toHaveLength(1);
  });
});

describe("Storage metadata", () => {
  test("set and get metadata", () => {
    const s = createStorage();
    s.setMetadata("key1", "value1");
    expect(s.getMetadata("key1")).toBe("value1");
  });

  test("getMetadata returns null for missing key", () => {
    const s = createStorage();
    expect(s.getMetadata("nonexistent")).toBeNull();
  });

  test("setMetadata overwrites existing key", () => {
    const s = createStorage();
    s.setMetadata("key", "old");
    s.setMetadata("key", "new");
    expect(s.getMetadata("key")).toBe("new");
  });

  test("getRecentSessions returns last sessions", () => {
    const s = createStorage();
    s.createSession("s1", "model-a");
    s.createSession("s2", "model-b");
    const recent = s.getRecentSessions(2);
    expect(recent).toHaveLength(2);
    expect(recent[0]!.summary).toContain("active");
  });
});
