import { describe, expect, it } from "vitest";
import { compileCapsule } from "@biomeweaver/biome-model";
import { renderJsonReport } from "@biomeweaver/biome-reports";
import { simulate } from "@biomeweaver/tick-runtime";
import { completeBiome } from "../helpers/paths.js";

describe("metamorphic properties", () => {
  it("preserves the prefix of an extended run", () => {
    const compiled = compileCapsule({ root: completeBiome("crystal-tundra") });
    const scenario = compiled.model!.scenarios["baseline"]!;
    const shortRun = simulate(compiled.model!, scenario, 5);
    const longRun = simulate(compiled.model!, scenario, 9);
    expect(longRun.states.slice(0, 6).map((state) => state.tick)).toEqual(
      shortRun.states.map((state) => state.tick),
    );
  });

  it("excludes absolute paths and wall-clock timestamps from reports", () => {
    const compiled = compileCapsule({ root: completeBiome("crystal-tundra") });
    const scenario = compiled.model!.scenarios["baseline"]!;
    const result = simulate(compiled.model!, scenario, 3);
    const report = renderJsonReport(result.states, result.flows);
    expect(report).not.toMatch(/[A-Za-z]:\\/);
    expect(report).not.toMatch(/T\d{2}:\d{2}:\d{2}/);
  });
});
