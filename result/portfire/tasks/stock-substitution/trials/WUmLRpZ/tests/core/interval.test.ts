import { describe, expect, it } from "vitest";
import {
  compareIntervals,
  contains,
  coverage,
  durationOf,
  fromDuration,
  gaps,
  hull,
  intersection,
  interval,
  isEmpty,
  merge,
  overlappingPairs,
  overlaps,
  peakOverlap,
  shift,
  sortIntervals,
} from "../../src/core/interval.js";
import { ms, raw } from "../../src/core/units.js";

const at = (start: number, end: number) => interval(ms(start), ms(end));

describe("construction", () => {
  it("holds a start and an end", () => {
    const value = at(1000, 4500);
    expect(raw(value.start)).toBe(1000);
    expect(raw(durationOf(value))).toBe(3500);
  });

  it("builds from a duration", () => {
    const value = fromDuration(ms(2000), ms(750));
    expect(raw(value.end)).toBe(2750);
  });

  it("allows an empty window", () => {
    expect(isEmpty(at(500, 500))).toBe(true);
    expect(isEmpty(at(500, 501))).toBe(false);
  });

  it("refuses a backwards window", () => {
    expect(() => at(4000, 1000)).toThrow(/before it starts/);
  });
});

describe("membership", () => {
  it("is half open", () => {
    const value = at(1000, 2000);
    expect(contains(value, ms(1000))).toBe(true);
    expect(contains(value, ms(1999))).toBe(true);
    expect(contains(value, ms(2000))).toBe(false);
    expect(contains(value, ms(999))).toBe(false);
  });

  it("treats touching windows as not overlapping", () => {
    expect(overlaps(at(0, 1000), at(1000, 2000))).toBe(false);
    expect(overlaps(at(0, 1001), at(1000, 2000))).toBe(true);
  });

  it("finds the shared part", () => {
    expect(intersection(at(0, 2000), at(1500, 3000))).toEqual(at(1500, 2000));
    expect(intersection(at(0, 1000), at(1000, 2000))).toBeUndefined();
  });

  it("builds the hull over a gap", () => {
    expect(hull(at(0, 500), at(3000, 4000))).toEqual(at(0, 4000));
  });
});

describe("shifting and ordering", () => {
  it("shifts both ends", () => {
    expect(shift(at(1000, 2000), ms(-400))).toEqual(at(600, 1600));
  });

  it("orders by start then end", () => {
    expect(compareIntervals(at(0, 100), at(50, 60))).toBeLessThan(0);
    expect(compareIntervals(at(0, 100), at(0, 60))).toBeGreaterThan(0);
    expect(compareIntervals(at(0, 100), at(0, 100))).toBe(0);
  });

  it("sorts without touching the input", () => {
    const input = [at(500, 600), at(0, 100)];
    const sorted = sortIntervals(input);
    expect(sorted[0]).toEqual(at(0, 100));
    expect(input[0]).toEqual(at(500, 600));
  });
});

describe("merge", () => {
  it("joins overlapping windows", () => {
    expect(merge([at(0, 2000), at(1500, 3000)])).toEqual([at(0, 3000)]);
  });

  it("joins touching windows into one run", () => {
    expect(merge([at(0, 1000), at(1000, 2000)])).toEqual([at(0, 2000)]);
  });

  it("keeps separate windows apart", () => {
    expect(merge([at(0, 1000), at(2000, 3000)])).toEqual([
      at(0, 1000),
      at(2000, 3000),
    ]);
  });

  it("swallows a window inside another", () => {
    expect(merge([at(0, 5000), at(1000, 2000)])).toEqual([at(0, 5000)]);
  });

  it("drops empty windows", () => {
    expect(merge([at(400, 400), at(0, 100)])).toEqual([at(0, 100)]);
  });

  it("handles nothing at all", () => {
    expect(merge([])).toEqual([]);
  });
});

describe("coverage and gaps", () => {
  it("counts overlapping time once", () => {
    expect(raw(coverage([at(0, 2000), at(1500, 3000)]))).toBe(3000);
  });

  it("adds separate windows", () => {
    expect(raw(coverage([at(0, 1000), at(4000, 4500)]))).toBe(1500);
  });

  it("finds the quiet stretches", () => {
    expect(gaps([at(0, 1000), at(4000, 4500), at(4200, 5000)])).toEqual([
      at(1000, 4000),
    ]);
  });

  it("reports no gaps for one run", () => {
    expect(gaps([at(0, 1000)])).toEqual([]);
  });
});

describe("peakOverlap", () => {
  it("finds how many are live at once and when", () => {
    const peak = peakOverlap([at(0, 3000), at(1000, 4000), at(1500, 2000)]);
    expect(peak.count).toBe(3);
    expect(raw(peak.at)).toBe(1500);
  });

  it("does not count a window that has just ended", () => {
    const peak = peakOverlap([at(0, 1000), at(1000, 2000)]);
    expect(peak.count).toBe(1);
  });

  it("returns zero for nothing", () => {
    expect(peakOverlap([]).count).toBe(0);
  });

  it("ignores empty windows", () => {
    expect(peakOverlap([at(500, 500), at(500, 500)]).count).toBe(0);
  });
});

describe("overlappingPairs", () => {
  it("names both indexes of each clash", () => {
    const pairs = overlappingPairs([
      at(0, 2000),
      at(1000, 3000),
      at(9000, 9500),
    ]);
    expect(pairs).toEqual([[0, 1]]);
  });

  it("keeps the indexes of the original list", () => {
    const pairs = overlappingPairs([at(5000, 6000), at(0, 5500)]);
    expect(pairs).toEqual([[0, 1]]);
  });

  it("finds several clashes", () => {
    const pairs = overlappingPairs([
      at(0, 3000),
      at(1000, 2000),
      at(2500, 4000),
    ]);
    expect(pairs).toEqual([
      [0, 1],
      [0, 2],
    ]);
  });

  it("finds nothing in a clean run", () => {
    expect(overlappingPairs([at(0, 1000), at(1000, 2000)])).toEqual([]);
  });
});
