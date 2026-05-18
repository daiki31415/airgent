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

    // Execute full chain twice (session reused)
    const dag = buildDAG(["clarify", "plan"]);
    await engine.execute("session-6", dag);
    await engine.execute("session-6", dag); // Second run

    // clarify should only execute once per session
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
});
