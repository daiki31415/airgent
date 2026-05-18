import { describe, expect, test } from "bun:test";
import { buildDAG } from "../index";
import type { PipelineNode } from "../../types";

describe("buildDAG", () => {
  test("returns empty nodes for empty input", () => {
    const dag = buildDAG([]);
    expect(dag.nodes).toEqual([]);
    expect(dag.entryPoints).toEqual([]);
  });

  test("resolves full dependency chain for generate", () => {
    const dag = buildDAG(["generate"]);
    const ids = dag.nodes.map(n => n.id);
    expect(ids).toContain("clarify");
    expect(ids).toContain("plan");
    expect(ids).toContain("prompt");
    expect(ids).toContain("generate");
    expect(ids.indexOf("clarify")).toBeLessThan(ids.indexOf("plan")!);
    expect(ids.indexOf("plan")!).toBeLessThan(ids.indexOf("prompt")!);
    expect(ids.indexOf("prompt")!).toBeLessThan(ids.indexOf("generate")!);
    expect(dag.entryPoints).toContain("clarify");
  });

  test("resolves all nodes for full pipeline", () => {
    const allNodes: PipelineNode[] = ["clarify", "plan", "prompt", "generate", "test", "merge", "validate", "report"];
    const dag = buildDAG(allNodes);
    expect(dag.nodes.length).toBe(8);
    expect(dag.entryPoints).toEqual(["clarify"]);
  });

  test("does not duplicate nodes", () => {
    const dag = buildDAG(["generate", "generate", "generate"]);
    const ids = dag.nodes.map(n => n.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  test("maintains correct dependency ordering", () => {
    const dag = buildDAG(["report"]);
    const ids = dag.nodes.map(n => n.id);
    const idx = (id: string) => ids.indexOf(id as PipelineNode);
    expect(idx("generate")).toBeLessThan(idx("test")!);
    expect(idx("test")!).toBeLessThan(idx("merge")!);
    expect(idx("merge")!).toBeLessThan(idx("validate")!);
    expect(idx("validate")!).toBeLessThan(idx("report")!);
  });
});
