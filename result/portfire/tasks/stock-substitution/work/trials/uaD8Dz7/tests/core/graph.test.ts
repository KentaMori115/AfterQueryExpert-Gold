import { describe, expect, it } from "vitest";
import {
  buildAdjacency,
  findCycle,
  hasCycle,
  leaves,
  nodesOf,
  reachableFrom,
  reverse,
  roots,
  topologicalOrder,
} from "../../src/core/graph.js";

const chain = buildAdjacency([
  ["show.pf", "cues/opening.pf"],
  ["show.pf", "cues/finale.pf"],
  ["cues/finale.pf", "lib/ripples.pf"],
]);

describe("buildAdjacency", () => {
  it("collects targets under each source", () => {
    expect(chain.get("show.pf")).toEqual(["cues/opening.pf", "cues/finale.pf"]);
  });

  it("gives a target with no outgoing edges an empty list", () => {
    expect(chain.get("cues/opening.pf")).toEqual([]);
  });

  it("lists every node once", () => {
    expect(nodesOf(chain).sort()).toEqual([
      "cues/finale.pf",
      "cues/opening.pf",
      "lib/ripples.pf",
      "show.pf",
    ]);
  });

  it("handles no edges at all", () => {
    expect(nodesOf(buildAdjacency([]))).toEqual([]);
  });
});

describe("topologicalOrder", () => {
  it("puts a source before everything it reaches", () => {
    const order = topologicalOrder(chain);
    expect(order).toBeDefined();
    const index = (name: string): number => order?.indexOf(name) ?? -1;
    expect(index("show.pf")).toBeLessThan(index("cues/finale.pf"));
    expect(index("cues/finale.pf")).toBeLessThan(index("lib/ripples.pf"));
  });

  it("breaks ties alphabetically so the order is stable", () => {
    const graph = buildAdjacency([
      ["root", "b"],
      ["root", "a"],
    ]);
    expect(topologicalOrder(graph)).toEqual(["root", "a", "b"]);
  });

  it("orders an empty graph", () => {
    expect(topologicalOrder(buildAdjacency([]))).toEqual([]);
  });

  it("gives up on a cycle", () => {
    const graph = buildAdjacency([
      ["a", "b"],
      ["b", "a"],
    ]);
    expect(topologicalOrder(graph)).toBeUndefined();
  });
});

describe("findCycle", () => {
  it("finds nothing in a clean graph", () => {
    expect(findCycle(chain)).toBeUndefined();
    expect(hasCycle(chain)).toBe(false);
  });

  it("names the loop with the start repeated", () => {
    const graph = buildAdjacency([
      ["a", "b"],
      ["b", "c"],
      ["c", "a"],
    ]);
    expect(findCycle(graph)).toEqual(["a", "b", "c", "a"]);
    expect(hasCycle(graph)).toBe(true);
  });

  it("finds a self loop", () => {
    const graph = buildAdjacency([["a", "a"]]);
    expect(findCycle(graph)).toEqual(["a", "a"]);
  });

  it("finds a cycle that hangs off a clean branch", () => {
    const graph = buildAdjacency([
      ["root", "clean"],
      ["root", "loop"],
      ["loop", "back"],
      ["back", "loop"],
    ]);
    // The walk starts at the alphabetically first node, so the loop is
    // reported from `back` rather than from wherever the edges were written.
    expect(findCycle(graph)).toEqual(["back", "loop", "back"]);
  });
});

describe("reachableFrom", () => {
  it("walks the whole chain", () => {
    expect([...reachableFrom(chain, "show.pf")].sort()).toEqual([
      "cues/finale.pf",
      "cues/opening.pf",
      "lib/ripples.pf",
    ]);
  });

  it("does not include the start", () => {
    expect(reachableFrom(chain, "show.pf").has("show.pf")).toBe(false);
  });

  it("finds nothing from a leaf", () => {
    expect(reachableFrom(chain, "lib/ripples.pf").size).toBe(0);
  });

  it("does not loop forever on a cycle", () => {
    const graph = buildAdjacency([
      ["a", "b"],
      ["b", "a"],
    ]);
    expect([...reachableFrom(graph, "a")].sort()).toEqual(["a", "b"]);
  });

  it("finds nothing from a node that is not there", () => {
    expect(reachableFrom(chain, "nowhere.pf").size).toBe(0);
  });
});

describe("roots and leaves", () => {
  it("finds the file nothing includes", () => {
    expect(roots(chain)).toEqual(["show.pf"]);
  });

  it("finds the files that include nothing", () => {
    expect(leaves(chain)).toEqual(["cues/opening.pf", "lib/ripples.pf"]);
  });

  it("has no roots in a pure cycle", () => {
    const graph = buildAdjacency([
      ["a", "b"],
      ["b", "a"],
    ]);
    expect(roots(graph)).toEqual([]);
  });
});

describe("reverse", () => {
  it("turns every edge around", () => {
    const reversed = reverse(chain);
    expect(reversed.get("cues/finale.pf")).toEqual(["show.pf"]);
    expect(reversed.get("show.pf")).toEqual([]);
  });

  it("sorts the incoming edges", () => {
    const graph = buildAdjacency([
      ["b", "target"],
      ["a", "target"],
    ]);
    expect(reverse(graph).get("target")).toEqual(["a", "b"]);
  });
});
