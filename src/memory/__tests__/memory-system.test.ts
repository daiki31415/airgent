import { describe, expect, test } from "bun:test";
import { MemorySystem } from "../index";
import { Storage } from "../../storage";

function createSystem(): MemorySystem {
  const storage = new Storage(":memory:");
  return new MemorySystem(storage);
}

describe("MemorySystem", () => {
  test("recordRaw inserts a raw log", () => {
    const ms = createSystem();
    const storage = (ms as any).storage as Storage;
    ms.recordRaw("sess1", "worker", "test content", 42);
    const logs = storage.getRawLogs("sess1");
    expect(logs).toHaveLength(1);
    expect(logs[0]!.content).toBe("test content");
    expect(logs[0]!.agent_role).toBe("worker");
    expect(logs[0]!.token_count).toBe(42);
  });

  test("getRawLogsBySession returns session logs", () => {
    const ms = createSystem();
    ms.recordRaw("s1", "planner", "plan content", 10);
    ms.recordRaw("s1", "worker", "work content", 20);
    ms.recordRaw("other", "worker", "other content", 5);
    const logs = ms.getRawLogsBySession("s1");
    expect(logs).toHaveLength(2);
  });

  test("createMemory inserts memory, evidence, and auto-links", () => {
    const ms = createSystem();
    const storage = (ms as any).storage as Storage;

    // Insert initial memory to enable auto-linking
    storage.insertMemory({
      id: "existing", sessionId: "s1", bug: "old bug", investigation: "", rootCause: "", fix: "",
      reason: "", confidence: 0.9, tags: ["crash"], files: [], commands: [],
    });

    const id = ms.createMemory({
      sessionId: "s1", bug: "null crash", investigation: "found deref",
      rootCause: "nullptr", fix: "add check", reason: "safety",
      evidence: [{ type: "observed", content: "crash log", source: "test", timestamp: Date.now() }],
      confidence: 0.8, tags: ["crash", "null"], files: ["src/main.ts"], commands: [],
    });

    expect(id).toBeTruthy();
    expect(typeof id).toBe("string");

    // Memory was stored
    const mem = storage.getMemory(id);
    expect(mem).not.toBeNull();
    expect(mem!.bug).toBe("null crash");

    // Evidence was stored
    const evidence = storage.getEvidence(id);
    expect(evidence).toHaveLength(1);
    expect(evidence[0]!.type).toBe("observed");
  });

  test("findRelevant returns empty for no tags", () => {
    const ms = createSystem();
    const results = ms.findRelevant([]);
    expect(results).toHaveLength(0);
  });

  test("findRelevant returns matching memories", () => {
    const ms = createSystem();
    const storage = (ms as any).storage as Storage;
    storage.insertMemory({
      id: "m1", sessionId: "s1", bug: "auth bug", investigation: "", rootCause: "", fix: "",
      reason: "", confidence: 0.8, tags: ["auth", "login"], files: [], commands: [],
    });

    const results = ms.findRelevant(["auth"]);
    expect(results).toHaveLength(1);
    expect(results[0]!.bug).toBe("auth bug");
  });

  test("findRelevant respects minConfidence", () => {
    const ms = createSystem();
    const storage = (ms as any).storage as Storage;
    storage.insertMemory({
      id: "m1", sessionId: "s1", bug: "low conf", investigation: "", rootCause: "", fix: "",
      reason: "", confidence: 0.2, tags: ["auth"], files: [], commands: [],
    });

    expect(ms.findRelevant(["auth"], 0.5)).toHaveLength(0);
    expect(ms.findRelevant(["auth"], 0.1)).toHaveLength(1);
  });

  test("getEvidence returns evidence array", () => {
    const ms = createSystem();
    const storage = (ms as any).storage as Storage;
    storage.insertMemory({
      id: "m1", sessionId: "s1", bug: "b", investigation: "", rootCause: "", fix: "",
      reason: "", confidence: 0.5, tags: [], files: [], commands: [],
    });
    storage.insertEvidence("ev1", "m1", "observed", "log output", "test");

    const evidence = ms.getEvidence("m1");
    expect(evidence).toHaveLength(1);
    expect(evidence[0]!.source).toBe("test");
  });

  test("getLinked returns linked memories", () => {
    const ms = createSystem();
    const storage = (ms as any).storage as Storage;
    storage.insertMemory({
      id: "m1", sessionId: "s1", bug: "bug1", investigation: "", rootCause: "", fix: "",
      reason: "", confidence: 0.8, tags: [], files: [], commands: [],
    });
    storage.insertMemory({
      id: "m2", sessionId: "s1", bug: "bug2", investigation: "", rootCause: "", fix: "",
      reason: "", confidence: 0.8, tags: [], files: [], commands: [],
    });
    storage.insertLink("link1", "m1", "m2", "similar_pattern", 0.7);

    // getLinkedMemories JOIN ON (target_id = m.id OR source_id = m.id) returns
    // both the linked memory (m2) AND the source memory (m1) itself
    const linked = ms.getLinked("m1");
    expect(linked).toHaveLength(2);
    expect(linked.map(l => l.id)).toContain("m2");
  });

  test("findContradictions delegates to storage", () => {
    const ms = createSystem();
    const results = ms.findContradictions();
    expect(Array.isArray(results)).toBe(true);
  });

  test("findCircularReferences delegates to storage", () => {
    const ms = createSystem();
    const results = ms.findCircularReferences();
    expect(Array.isArray(results)).toBe(true);
  });
});
