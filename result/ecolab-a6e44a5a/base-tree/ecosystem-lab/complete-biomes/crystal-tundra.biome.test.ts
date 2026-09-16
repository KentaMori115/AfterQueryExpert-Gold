import { describe, expect, it } from "vitest";
import { compileCapsule } from "@biomeweaver/biome-model";
import { runCommand } from "@biomeweaver/cli";
import { simulate } from "@biomeweaver/tick-runtime";
import { completeBiome } from "../helpers/paths.js";

describe("crystal-tundra biome", () => {
  it("compiles without errors", () => {
    const compiled = compileCapsule({ root: completeBiome("crystal-tundra") });
    expect(compiled.model?.biome).toBe("crystal-tundra");
    expect(compiled.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
  });

  it("advances the baseline scenario for 12 ticks without negative quantities", () => {
    const compiled = compileCapsule({ root: completeBiome("crystal-tundra") });
    const scenario = compiled.model?.scenarios["baseline"];
    expect(scenario).toBeDefined();
    const result = simulate(compiled.model!, scenario!, 12);
    expect(result.states).toHaveLength(13);
    for (const state of result.states) {
      for (const cohort of state.cohorts) {
        expect(cohort.count >= 0n).toBe(true);
      }
      for (const pool of state.pools) {
        expect(pool.quantity >= 0n).toBe(true);
      }
    }
  });

  it("lists species through the public command", () => {
    const result = runCommand(["species", "list", "--root", completeBiome("crystal-tundra")]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("snow-hare");
    expect(result.stdout).toContain("glass-lynx");
  });
});
