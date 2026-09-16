import { describe, expect, it } from "vitest";
import { compileCapsule } from "./compile.js";
import { completeBiome } from "../../../ecosystem-lab/helpers/paths.js";

describe("crystal-tundra species catalog", () => {
  const compiled = compileCapsule({ root: completeBiome("crystal-tundra") });
  const species = compiled.model!.species;

  it.each(["snow-hare", "glass-lynx", "dune-beetle", "marsh-bird", "silver-grass"])(
    "includes species %s",
    (id) => {
      expect(species[id]).toBeDefined();
    },
  );

  it.each(["northern-basin", "ice-river", "southern-ridge"])("includes region %s", (id) => {
    expect(compiled.model!.regions[id]).toBeDefined();
  });

  it.each(["baseline", "long-winter", "habitat-loss"])("includes scenario %s", (id) => {
    expect(compiled.model!.scenarios[id]).toBeDefined();
  });

  it.each(["silver-grass-biomass", "fresh-water", "mineral-salt"])("includes resource %s", (id) => {
    expect(compiled.model!.resources[id]).toBeDefined();
  });

  it("uses half-even rounding", () => {
    expect(compiled.model!.precision.rounding).toBe("half-even");
  });

  it("uses a million-unit scale", () => {
    expect(compiled.model!.precision.scale).toBe(1_000_000n);
  });
});
