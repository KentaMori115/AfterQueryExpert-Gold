import { describe, expect, it } from "vitest";
import {
  attempt,
  both,
  collect,
  err,
  errAll,
  expect as expectValue,
  flatMap,
  isErr,
  isOk,
  map,
  mapErr,
  ok,
  partition,
  traverse,
  unwrapOr,
} from "../../src/core/result.js";
import type { Result } from "../../src/core/result.js";

describe("construction", () => {
  it("carries a value", () => {
    const result = ok(7);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(7);
  });

  it("carries every error it was given", () => {
    const result = err("a", "b");
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(["a", "b"]);
  });

  it("refuses an Err with nothing in it", () => {
    expect(() => err()).toThrow(/at least one/);
    expect(() => errAll([])).toThrow(/at least one/);
  });

  it("narrows with the guards", () => {
    const good: Result<number, string> = ok(1);
    const bad: Result<number, string> = err("no");
    expect(isOk(good)).toBe(true);
    expect(isErr(good)).toBe(false);
    expect(isOk(bad)).toBe(false);
    expect(isErr(bad)).toBe(true);
  });
});

describe("mapping", () => {
  it("maps a value and leaves an error alone", () => {
    expect(map(ok(3), (n) => n * 2)).toEqual(ok(6));
    const bad: Result<number, string> = err("boom");
    expect(map(bad, (n: number) => n * 2)).toEqual(bad);
  });

  it("maps errors", () => {
    const mapped = mapErr(err("a", "b"), (e) => e.toUpperCase());
    expect(mapped).toEqual(err("A", "B"));
  });

  it("does not touch the value when mapping errors", () => {
    expect(mapErr(ok(4), (e: string) => e)).toEqual(ok(4));
  });

  it("chains", () => {
    const half = (n: number): Result<number, string> =>
      n % 2 === 0 ? ok(n / 2) : err(`${n} is odd`);
    expect(flatMap(ok(8), half)).toEqual(ok(4));
    expect(flatMap(ok(7), half)).toEqual(err("7 is odd"));
    expect(flatMap(err<string>("earlier"), half)).toEqual(err("earlier"));
  });
});

describe("unwrapping", () => {
  it("falls back", () => {
    expect(unwrapOr(ok(2), 9)).toBe(2);
    expect(unwrapOr(err<string>("no"), 9)).toBe(9);
  });

  it("throws with every error joined", () => {
    expect(() => expectValue(err("first", "second"), "load rig")).toThrow(
      "load rig: first; second",
    );
  });

  it("describes an Error object", () => {
    expect(() => expectValue(err(new Error("bad pin")), "parse")).toThrow(
      /bad pin/,
    );
  });

  it("describes a diagnostic shaped object", () => {
    expect(() =>
      expectValue(err({ code: "E1", message: "no such cue" }), "resolve"),
    ).toThrow(/no such cue/);
  });

  it("falls back to JSON for anything else", () => {
    expect(() => expectValue(err({ code: 4 }), "resolve")).toThrow(/"code":4/);
  });

  it("returns the value when there is one", () => {
    expect(expectValue(ok("fine"), "load")).toBe("fine");
  });
});

describe("collecting", () => {
  it("gathers values in order", () => {
    expect(collect([ok(1), ok(2), ok(3)])).toEqual(ok([1, 2, 3]));
  });

  it("gathers every error rather than the first", () => {
    const results: Result<number, string>[] = [
      ok(1),
      err("bad cue 4"),
      ok(2),
      err("bad cue 9", "bad cue 11"),
    ];
    const collected = collect(results);
    expect(isErr(collected)).toBe(true);
    if (isErr(collected)) {
      expect(collected.errors).toEqual([
        "bad cue 4",
        "bad cue 9",
        "bad cue 11",
      ]);
    }
  });

  it("collects an empty list into an empty value", () => {
    expect(collect<number, string>([])).toEqual(ok([]));
  });

  it("traverses with the index", () => {
    const traversed = traverse(["a", "b"], (item, index) =>
      ok(`${index}${item}`),
    );
    expect(traversed).toEqual(ok(["0a", "1b"]));
  });

  it("traverses and reports every failure", () => {
    const traversed = traverse([1, 2, 3, 4], (n) =>
      n % 2 === 0 ? ok(n) : err(`${n} is odd`),
    );
    expect(traversed).toEqual(err("1 is odd", "3 is odd"));
  });
});

describe("partition", () => {
  it("keeps what worked alongside what did not", () => {
    const split = partition([ok(1), err<string>("no"), ok(2)]);
    expect(split.values).toEqual([1, 2]);
    expect(split.errors).toEqual(["no"]);
  });

  it("handles an all good list", () => {
    const split = partition([ok(1), ok(2)]);
    expect(split.errors).toEqual([]);
  });
});

describe("both", () => {
  it("pairs two values", () => {
    expect(both(ok(1), ok("x"))).toEqual(ok([1, "x"]));
  });

  it("keeps both sides' errors", () => {
    const paired = both(err<string>("left"), err<string>("right"));
    expect(paired).toEqual(err("left", "right"));
  });

  it("keeps one side's errors when the other is fine", () => {
    expect(both(ok(1), err<string>("right"))).toEqual(err("right"));
    expect(both(err<string>("left"), ok(1))).toEqual(err("left"));
  });
});

describe("attempt", () => {
  it("catches a throw", () => {
    const caught = attempt(() => {
      throw new RangeError("caliber out of range");
    });
    expect(caught).toEqual(err("caliber out of range"));
  });

  it("passes a value through", () => {
    expect(attempt(() => 42)).toEqual(ok(42));
  });
});
