import { describe, expect, it } from "vitest";
import {
  approxEqual,
  bucketBy,
  ceilTo,
  clamp,
  floorTo,
  histogram,
  inverseLerp,
  isMonotonic,
  lerp,
  maxOf,
  mean,
  median,
  minOf,
  percentile,
  roundTo,
  stdDev,
  sum,
  variance,
} from "../../src/core/numeric.js";

describe("clamp and lerp", () => {
  it("clamps into the range", () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-5, 0, 10)).toBe(0);
    expect(clamp(15, 0, 10)).toBe(10);
  });

  it("refuses backwards bounds", () => {
    expect(() => clamp(1, 10, 0)).toThrow(/backwards/);
  });

  it("interpolates", () => {
    expect(lerp(0, 100, 0.25)).toBe(25);
    expect(lerp(10, 20, 0)).toBe(10);
    expect(lerp(10, 20, 1)).toBe(20);
  });

  it("inverts, clamped", () => {
    expect(inverseLerp(0, 100, 25)).toBe(0.25);
    expect(inverseLerp(0, 100, 400)).toBe(1);
    expect(inverseLerp(5, 5, 5)).toBe(0);
  });
});

describe("rounding", () => {
  it("snaps to a step", () => {
    expect(roundTo(83, 40)).toBe(80);
    expect(roundTo(105, 40)).toBe(120);
  });

  it("floors and ceils to a step", () => {
    expect(floorTo(105, 40)).toBe(80);
    expect(ceilTo(105, 40)).toBe(120);
    expect(floorTo(80, 40)).toBe(80);
    expect(ceilTo(80, 40)).toBe(80);
  });

  it("does not leave float dust behind", () => {
    expect(roundTo(1000, 1000 / 30)).toBe(1000);
  });

  it("refuses a step of zero or less", () => {
    expect(() => roundTo(1, 0)).toThrow(/positive/);
    expect(() => floorTo(1, -2)).toThrow(/positive/);
    expect(() => ceilTo(1, 0)).toThrow(/positive/);
  });

  it("compares with a tolerance", () => {
    expect(approxEqual(0.1 + 0.2, 0.3)).toBe(true);
    expect(approxEqual(1, 1.5)).toBe(false);
    expect(approxEqual(1, 1.4, 0.5)).toBe(true);
  });
});

describe("aggregates", () => {
  const values = [4, 8, 15, 16, 23, 42];

  it("sums and averages", () => {
    expect(sum(values)).toBe(108);
    expect(mean(values)).toBe(18);
  });

  it("gives zero for an empty list rather than NaN", () => {
    expect(sum([])).toBe(0);
    expect(mean([])).toBe(0);
    expect(median([])).toBe(0);
    expect(variance([])).toBe(0);
    expect(stdDev([])).toBe(0);
  });

  it("finds the median of an even and an odd list", () => {
    expect(median([1, 2, 3])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });

  it("interpolates a percentile", () => {
    expect(percentile([0, 10], 0.5)).toBe(5);
    expect(percentile([0, 10], 0)).toBe(0);
    expect(percentile([0, 10], 1)).toBe(10);
  });

  it("clamps a percentile fraction", () => {
    expect(percentile([0, 10], 4)).toBe(10);
    expect(percentile([0, 10], -1)).toBe(0);
  });

  it("does not care about input order", () => {
    expect(median([42, 4, 8])).toBe(8);
  });

  it("uses the sample variance", () => {
    expect(variance([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(4.571, 3);
    expect(stdDev([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2.138, 3);
    expect(variance([5])).toBe(0);
  });

  it("finds extremes and reports nothing for an empty list", () => {
    expect(minOf(values)).toBe(4);
    expect(maxOf(values)).toBe(42);
    expect(minOf([])).toBeUndefined();
    expect(maxOf([])).toBeUndefined();
  });
});

describe("isMonotonic", () => {
  it("accepts a rising or level run", () => {
    expect(isMonotonic([1, 2, 2, 5])).toBe(true);
    expect(isMonotonic([])).toBe(true);
    expect(isMonotonic([7])).toBe(true);
  });

  it("rejects a step backwards", () => {
    expect(isMonotonic([1, 5, 4])).toBe(false);
  });
});

describe("histogram", () => {
  it("splits the range into even buckets", () => {
    const buckets = histogram([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], 2);
    expect(buckets).toHaveLength(2);
    expect(buckets[0]?.count).toBe(5);
    expect(buckets[1]?.count).toBe(5);
  });

  it("puts the maximum in the last bucket", () => {
    const buckets = histogram([0, 10], 5);
    expect(buckets[4]?.count).toBe(1);
  });

  it("copes with every value being the same", () => {
    const buckets = histogram([7, 7, 7], 3);
    expect(buckets[0]?.count).toBe(3);
  });

  it("returns nothing for no data", () => {
    expect(histogram([], 4)).toEqual([]);
  });

  it("refuses a nonsense bucket count", () => {
    expect(() => histogram([1], 0)).toThrow(/positive whole/);
    expect(() => histogram([1], 2.5)).toThrow(/positive whole/);
  });
});

describe("bucketBy", () => {
  it("counts into fixed width slices from zero", () => {
    const buckets = bucketBy([0, 4, 9, 10, 11, 25], 10);
    expect(buckets.get(0)).toBe(3);
    expect(buckets.get(10)).toBe(2);
    expect(buckets.get(20)).toBe(1);
  });

  it("leaves an empty slice out rather than at zero", () => {
    expect(bucketBy([0, 25], 10).has(10)).toBe(false);
  });

  it("refuses a width of zero", () => {
    expect(() => bucketBy([1], 0)).toThrow(/positive/);
  });
});
