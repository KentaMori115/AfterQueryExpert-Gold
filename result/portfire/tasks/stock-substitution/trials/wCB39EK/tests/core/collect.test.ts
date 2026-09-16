import { describe, expect, it } from "vitest";
import {
  countBy,
  distinct,
  groupBy,
  rankedEntries,
  sortedEntries,
  sumBy,
} from "../../src/core/collect.js";
import { compareIds } from "../../src/core/ids.js";

const shots = [
  { effect: "shell.150", position: "pad.a", grams: 480 },
  { effect: "shell.75", position: "pad.b", grams: 60 },
  { effect: "shell.150", position: "pad.b", grams: 480 },
  { effect: "shell.150", position: "pad.a", grams: 480 },
];

describe("countBy", () => {
  it("tallies by the key", () => {
    const counts = countBy(shots, (shot) => shot.effect);
    expect(counts.get("shell.150")).toBe(3);
    expect(counts.get("shell.75")).toBe(1);
  });

  it("counts nothing for an empty list", () => {
    expect(countBy([], () => "x").size).toBe(0);
  });
});

describe("sumBy", () => {
  it("adds a value per key", () => {
    const totals = sumBy(
      shots,
      (shot) => shot.effect,
      (shot) => shot.grams,
    );
    expect(totals.get("shell.150")).toBe(1440);
    expect(totals.get("shell.75")).toBe(60);
  });

  it("handles a value of zero", () => {
    const totals = sumBy(
      [{ k: "a", v: 0 }],
      (item) => item.k,
      (item) => item.v,
    );
    expect(totals.get("a")).toBe(0);
  });
});

describe("groupBy", () => {
  it("collects items under their key", () => {
    const groups = groupBy(shots, (shot) => shot.position);
    expect(groups.get("pad.a")).toHaveLength(2);
    expect(groups.get("pad.b")).toHaveLength(2);
  });

  it("keeps the order items arrived in", () => {
    const groups = groupBy(shots, (shot) => shot.position);
    expect(groups.get("pad.b")?.[0]?.effect).toBe("shell.75");
  });
});

describe("sortedEntries", () => {
  it("orders by key rather than by insertion", () => {
    const counts = countBy(shots, (shot) => shot.effect);
    expect(sortedEntries(counts).map(([key]) => key)).toEqual([
      "shell.150",
      "shell.75",
    ]);
  });

  it("takes a comparator, so ids sort the way a person reads them", () => {
    const counts = countBy(shots, (shot) => shot.effect);
    expect(sortedEntries(counts, compareIds).map(([key]) => key)).toEqual([
      "shell.75",
      "shell.150",
    ]);
  });
});

describe("rankedEntries", () => {
  it("puts the largest first", () => {
    const counts = countBy(shots, (shot) => shot.effect);
    expect(rankedEntries(counts)[0]).toEqual(["shell.150", 3]);
  });

  it("breaks a tie by key", () => {
    const counts = new Map([
      ["b", 2],
      ["a", 2],
    ]);
    expect(rankedEntries(counts).map(([key]) => key)).toEqual(["a", "b"]);
  });
});

describe("distinct", () => {
  it("lists each value once, sorted", () => {
    expect(distinct(shots, (shot) => shot.position)).toEqual([
      "pad.a",
      "pad.b",
    ]);
  });

  it("lists nothing for an empty input", () => {
    expect(distinct([], () => "x")).toEqual([]);
  });
});
