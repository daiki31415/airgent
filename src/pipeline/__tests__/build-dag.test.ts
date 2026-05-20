import { describe, expect, test } from "bun:test";
import { buildDAG } from "../index";
import type { PipelineNode } from "../../types";

describe("buildDAG", () => {
  test("returns empty nodes for empty input", () => {
    const dag = buildDAG([]);
    expect(dag.nodes).toEqual([]);
  });

  test("resolves full dependency chain for generate", () => {
    const dag = buildDAG(["generate"]);
    const ids = dag.nodes.map(n => n.id);
    expect(ids).toContain("clarify");
    expect(ids).toContain("plan");
    expect(ids).toContain("generate");
    expect(ids.indexOf("clarify")).toBeLessThan(ids.indexOf("plan")!);
    expect(ids.indexOf("plan")!).toBeLessThan(ids.indexOf("generate")!);
  });

  test("resolves all nodes for full pipeline", () => {
    const allNodes: PipelineNode[] = ["clarify", "plan", "generate", "test", "validate", "report"];
    const dag = buildDAG(allNodes);
    expect(dag.nodes.length).toBe(6);
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
    expect(idx("clarify")).toBeLessThan(idx("plan")!);
    expect(idx("plan")!).toBeLessThan(idx("generate")!);
    expect(idx("generate")!).toBeLessThan(idx("test")!);
    expect(idx("generate")!).toBeLessThan(idx("validate")!);
    expect(idx("test")!).toBeLessThan(idx("report")!);
    expect(idx("validate")!).toBeLessThan(idx("report")!);
  });

  test("single clarify node", () => {
    const dag = buildDAG(["clarify"]);
    expect(dag.nodes.length).toBe(1);
    expect(dag.nodes[0]!.id).toBe("clarify");
  });

  test("single plan node includes clarify dependency", () => {
    const dag = buildDAG(["plan"]);
    const ids = dag.nodes.map(n => n.id);
    expect(ids).toContain("clarify");
    expect(ids).toContain("plan");
    expect(ids.indexOf("clarify")).toBeLessThan(ids.indexOf("plan")!);
  });

  test("validate depends on generate (parallel sibling of test)", () => {
    const dag = buildDAG(["validate"]);
    const ids = dag.nodes.map(n => n.id);
    expect(ids).toEqual(["clarify", "plan", "generate", "validate"]);
  });

  test("report pulls in entire pipeline", () => {
    const dag = buildDAG(["report"]);
    const ids = dag.nodes.map(n => n.id);
    expect(ids).toEqual(["clarify", "plan", "generate", "test", "validate", "report"]);
  });

  test("clarify has no dependencies", () => {
    const dag = buildDAG(["clarify"]);
    expect(dag.nodes[0]!.dependsOn).toEqual([]);
  });

  test("each node has correct dependency edges", () => {
    const dag = buildDAG(["clarify", "plan", "generate", "test", "validate", "report"]);
    const byId = new Map(dag.nodes.map(n => [n.id, n]));
    expect(byId.get("clarify")!.dependsOn).toEqual([]);
    expect(byId.get("plan")!.dependsOn).toEqual(["clarify"]);
    expect(byId.get("generate")!.dependsOn).toEqual(["plan"]);
    expect(byId.get("test")!.dependsOn).toEqual(["generate"]);
    expect(byId.get("validate")!.dependsOn).toEqual(["generate"]);
    expect(byId.get("report")!.dependsOn).toEqual(["test", "validate"]);
  });

  test("timeout is set on each node", () => {
    const dag = buildDAG(["generate"]);
    for (const node of dag.nodes) {
      expect(node.timeout).toBeGreaterThan(0);
    }
  });

  test("each node has maxRetries defined", () => {
    const dag = buildDAG(["report"]);
    for (const node of dag.nodes) {
      expect(node.maxRetries).toBeGreaterThanOrEqual(1);
    }
  });
});
