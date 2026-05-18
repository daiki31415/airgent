import { describe, expect, test, mock } from "bun:test";
import { PipelineEngine, buildDAG } from "../index";

describe("PipelineEngine execute", () => {
  test("executes a single node handler", async () => {
    const engine = new PipelineEngine();
    engine.registerHandler("clarify", async () => ({ content: "analyzed" }));

    const dag = buildDAG(["clarify"]);
    const results = await engine.execute("session-1", dag);

    expect(results.get("clarify")).toEqual({ content: "analyzed" });
  });

  test("executes nodes in dependency order", async () => {
    const order: string[] = [];
    const engine = new PipelineEngine();
    engine.registerHandler("clarify", async () => { order.push("clarify"); return { content: "c" }; });
    engine.registerHandler("plan", async () => { order.push("plan"); return { content: "p" }; });
    engine.registerHandler("prompt", async () => { order.push("prompt"); return { content: "pr" }; });
    engine.registerHandler("generate", async () => { order.push("generate"); return { content: "g" }; });

    const dag = buildDAG(["generate"]);
    await engine.execute("session-2", dag);

    expect(order).toEqual(["clarify", "plan", "prompt", "generate"]);
  });

  test("returns error when handler not registered", async () => {
    const engine = new PipelineEngine();
    const dag = buildDAG(["clarify"]);

    expect(engine.execute("session-3", dag)).rejects.toThrow("No handler for: clarify");
  });

  test("retries on handler failure and succeeds", async () => {
    let attempts = 0;
    const engine = new PipelineEngine();
    engine.registerHandler("clarify", async () => {
      attempts++;
      if (attempts < 2) throw new Error("transient failure");
      return { content: "ok" };
    });

    const dag = buildDAG(["clarify"]);
    const results = await engine.execute("session-4", dag);

    expect(attempts).toBe(2);
    expect(results.get("clarify")).toEqual({ content: "ok" });
  });

  test("throws after exhausting retries", async () => {
    const engine = new PipelineEngine();
    engine.registerHandler("clarify", async () => {
      throw new Error("persistent failure");
    });

    const dag = buildDAG(["clarify"]);
    expect(engine.execute("session-5", dag)).rejects.toThrow("persistent failure");
  });

  test("skips already completed nodes", async () => {
    const clarificationCalls: number[] = [];
    const engine = new PipelineEngine();
    engine.registerHandler("clarify", async () => {
      clarificationCalls.push(1);
      return { content: "c" };
    });
    engine.registerHandler("plan", async () => ({ content: "p" }));

    const dag = buildDAG(["clarify", "plan"]);
    await engine.execute("session-6", dag);
    await engine.execute("session-6", dag);

    expect(clarificationCalls.length).toBe(1);
  });

  test("tracks pipeline state", async () => {
    const engine = new PipelineEngine();
    engine.registerHandler("clarify", async () => ({ content: "c" }));

    const dag = buildDAG(["clarify"]);
    await engine.execute("session-7", dag);

    const state = engine.getState("session-7");
    expect(state).toBeDefined();
    expect(state!.completedNodes).toContain("clarify");
    expect(state!.failedNodes).toEqual([]);
  });

  test("resets session state", async () => {
    const engine = new PipelineEngine();
    engine.registerHandler("clarify", async () => ({ content: "c" }));

    const dag = buildDAG(["clarify"]);
    await engine.execute("session-8", dag);
    engine.reset("session-8");

    expect(engine.getState("session-8")).toBeUndefined();
  });

  test("allows multiple independent sessions", async () => {
    const engine = new PipelineEngine();
    let counter = 0;
    engine.registerHandler("clarify", async () => ({ content: `${counter++}` }));

    const dag = buildDAG(["clarify"]);
    const r1 = await engine.execute("sess-a", dag);
    const r2 = await engine.execute("sess-b", dag);

    expect(r1.get("clarify")).toEqual({ content: "0" });
    expect(r2.get("clarify")).toEqual({ content: "1" });
  });

  test("handler error propagates correctly", async () => {
    const engine = new PipelineEngine();
    engine.registerHandler("clarify", async () => { throw new Error("handler-error"); });

    const dag = buildDAG(["clarify"]);
    expect(engine.execute("session-e1", dag)).rejects.toThrow("handler-error");
  });

  test("empty DAG executes without error", async () => {
    const engine = new PipelineEngine();
    const dag = buildDAG([]);
    const results = await engine.execute("session-empty", dag);
    expect(results.size).toBe(0);
  });

  test("completed nodes are tracked in state", async () => {
    const engine = new PipelineEngine();
    engine.registerHandler("clarify", async () => ({ content: "c" }));
    engine.registerHandler("plan", async () => ({ content: "p" }));

    const dag = buildDAG(["clarify", "plan"]);
    await engine.execute("session-s1", dag);

    const state = engine.getState("session-s1");
    expect(state!.completedNodes).toEqual(["clarify", "plan"]);
  });

  test("reset works on state with no data", () => {
    const engine = new PipelineEngine();
    engine.reset("nonexistent");
    expect(engine.getState("nonexistent")).toBeUndefined();
  });
});
