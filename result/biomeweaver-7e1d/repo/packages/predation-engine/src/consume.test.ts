import { describe, expect, it } from "vitest";
import { applyPredation } from "./consume.js";
import { DEFAULT_SCALE } from "@biomeweaver/fixed-point";
import type { CompiledBiome } from "@biomeweaver/biome-model";

describe("authored predation", () => {
  it("removes prey without exceeding the prey count", () => {
    const model = {
      precision: { scale: DEFAULT_SCALE, rounding: "half-even" },
      species: {
        "glass-lynx": {
          predation: [{ prey: "snow-hare", preyStage: "adult", perPredatorPerTick: 200_000n }],
        },
      },
    } as unknown as CompiledBiome;
    const result = applyPredation(model, [
      {
        species: "glass-lynx",
        stage: "adult",
        region: "northern-basin",
        count: 80_000_000n,
        condition: DEFAULT_SCALE,
        ageTicks: 0,
      },
      {
        species: "snow-hare",
        stage: "adult",
        region: "northern-basin",
        count: 10_000_000n,
        condition: DEFAULT_SCALE,
        ageTicks: 0,
      },
    ]);
    const hare = result.cohorts.find((cohort) => cohort.species === "snow-hare");
    expect(hare?.count).toBe(0n);
    expect(result.removals[0]?.quantity).toBe(10_000_000n);
  });
});
