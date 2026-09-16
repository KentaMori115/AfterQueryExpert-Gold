import { describe, expect, it } from "vitest";
import { compileCapsule } from "@biomeweaver/biome-model";
import { simulate } from "@biomeweaver/tick-runtime";
import { parseFixed, DEFAULT_SCALE } from "@biomeweaver/fixed-point";
import { completeBiome } from "../helpers/paths.js";

describe("flow conservation", () => {
  it("keeps every flow pointing at an authored rule string", () => {
    const compiled = compileCapsule({ root: completeBiome("crystal-tundra") });
    const result = simulate(compiled.model!, compiled.model!.scenarios["baseline"]!, 6);
    expect(result.flows.every((flow) => flow.rule.length > 0)).toBe(true);
  });

  it("parses every flow quantity as a non-negative fixed-point value", () => {
    const compiled = compileCapsule({ root: completeBiome("crystal-tundra") });
    const result = simulate(compiled.model!, compiled.model!.scenarios["baseline"]!, 6);
    for (const flow of result.flows) {
      expect(parseFixed(flow.quantity, DEFAULT_SCALE) >= 0n).toBe(true);
    }
  });
});
