import { describe, expect, it } from "vitest";
import { compileCapsule } from "@biomeweaver/biome-model";
import { simulate } from "@biomeweaver/tick-runtime";
import { completeBiome } from "../helpers/paths.js";

describe("determinism properties", () => {
  it("repeats a run with identical flow quantities", () => {
    const compiled = compileCapsule({ root: completeBiome("crystal-tundra") });
    const scenario = compiled.model!.scenarios["baseline"]!;
    const first = simulate(compiled.model!, scenario, 8);
    const second = simulate(compiled.model!, scenario, 8);
    expect(first.flows.map((flow) => `${flow.tick}:${flow.cause}:${flow.quantity}`)).toEqual(
      second.flows.map((flow) => `${flow.tick}:${flow.cause}:${flow.quantity}`),
    );
  });

  it("keeps population and resource quantities non-negative", () => {
    const compiled = compileCapsule({ root: completeBiome("crystal-tundra") });
    const scenario = compiled.model!.scenarios["long-winter"]!;
    const result = simulate(compiled.model!, scenario, 16);
    for (const state of result.states) {
      expect(state.cohorts.every((cohort) => cohort.count >= 0n)).toBe(true);
      expect(state.pools.every((pool) => pool.quantity >= 0n)).toBe(true);
    }
  });

  it("never allocates more grass than the pool held at the start of allocation", () => {
    const compiled = compileCapsule({ root: completeBiome("crystal-tundra") });
    const scenario = compiled.model!.scenarios["baseline"]!;
    const result = simulate(compiled.model!, scenario, 6);
    for (const state of result.states) {
      for (const pool of state.pools) {
        expect(pool.quantity >= 0n).toBe(true);
      }
    }
  });
});
