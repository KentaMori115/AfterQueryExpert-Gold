import { describe, expect, it } from "vitest";
import { compileCapsule } from "@biomeweaver/biome-model";
import { PHASES, simulate } from "./index.js";
import { completeBiome } from "../../../ecosystem-lab/helpers/paths.js";

describe("tick runtime", () => {
  it("documents the Seed World phase order", () => {
    expect(PHASES).toEqual([
      "apply-fixed-events",
      "renew-resources",
      "calculate-demand",
      "allocate-resources",
      "apply-condition",
      "apply-mortality",
      "apply-predation",
      "apply-reproduction",
      "advance-stages",
      "enforce-invariants",
      "write-flows",
    ]);
  });

  it("records initial-state flows at tick zero", () => {
    const compiled = compileCapsule({ root: completeBiome("crystal-tundra") });
    const result = simulate(compiled.model!, compiled.model!.scenarios["baseline"]!, 1);
    expect(result.flows.some((flow) => flow.cause === "initial-state")).toBe(true);
  });

  it("applies the winter-extension event on tick 30", () => {
    const compiled = compileCapsule({ root: completeBiome("crystal-tundra") });
    const result = simulate(compiled.model!, compiled.model!.scenarios["long-winter"]!, 30);
    expect(result.flows.some((flow) => flow.cause === "fixed-event" && flow.tick === 30)).toBe(
      true,
    );
  });
});
