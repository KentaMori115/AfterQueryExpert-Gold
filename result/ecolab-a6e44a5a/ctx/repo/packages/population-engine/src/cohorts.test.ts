import { describe, expect, it } from "vitest";
import { DEFAULT_SCALE } from "@biomeweaver/fixed-point";
import { applyCondition, applyMortality, applyReproduction, mergeCohorts } from "./cohorts.js";

const base = {
  species: "snow-hare",
  stage: "adult",
  region: "northern-basin",
  count: 850_000_000n,
  condition: DEFAULT_SCALE,
  ageTicks: 0,
};

describe("population engine", () => {
  it("lowers condition when allocation is below demand", () => {
    const next = applyCondition(base, 100n, 25n, DEFAULT_SCALE);
    expect(next.condition).toBeLessThan(base.condition);
  });

  it("applies baseline mortality without going negative", () => {
    const result = applyMortality(base, 8_000n, DEFAULT_SCALE);
    expect(result.deaths).toBeGreaterThan(0n);
    expect(result.cohort.count).toBeGreaterThanOrEqual(0n);
    expect(result.cohort.count + result.deaths).toBe(base.count);
  });

  it("skips reproduction when condition is below the threshold", () => {
    const starved = { ...base, condition: 100_000n };
    expect(
      applyReproduction(starved, 40_000n, 650_000n, "juvenile", DEFAULT_SCALE),
    ).toBeUndefined();
  });

  it("merges matching cohorts", () => {
    const merged = mergeCohorts([base, { ...base, count: 150_000_000n, stage: "adult" }]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.count).toBe(1_000_000_000n);
  });
});
