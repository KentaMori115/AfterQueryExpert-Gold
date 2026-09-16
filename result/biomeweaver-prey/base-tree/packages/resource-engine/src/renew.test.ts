import { describe, expect, it } from "vitest";
import { DEFAULT_SCALE } from "@biomeweaver/fixed-point";
import { habitatModifier, renewPool } from "./renew.js";
import { sourceLocation } from "@biomeweaver/capsule-source";
import type { CompiledBiome, HabitatRecord } from "@biomeweaver/biome-model";

const habitat: HabitatRecord = {
  kind: "habitat",
  id: "silver-grassland",
  region: "northern-basin",
  capacity: {},
  modifiers: {
    winter: { "silver-grass-biomass-growth": 350_000n },
    summer: { "silver-grass-biomass-growth": 1_400_000n },
  },
  location: sourceLocation("habitats/silver-grassland.yaml"),
};

describe("resource renewal", () => {
  it("reads a winter growth modifier", () => {
    expect(
      habitatModifier(
        [habitat],
        "northern-basin",
        "winter",
        "silver-grass-biomass-growth",
        DEFAULT_SCALE,
      ),
    ).toBe(350_000n);
  });

  it("reads a summer growth modifier", () => {
    expect(
      habitatModifier(
        [habitat],
        "northern-basin",
        "summer",
        "silver-grass-biomass-growth",
        DEFAULT_SCALE,
      ),
    ).toBe(1_400_000n);
  });

  it("adds renewable growth to a pool", () => {
    const model = {
      precision: { scale: DEFAULT_SCALE, rounding: "half-even" },
      habitats: { "silver-grassland": habitat },
      resources: {
        "silver-grass-biomass": {
          renewable: true,
          renewalPerTick: 80_000_000n,
        },
      },
    } as unknown as CompiledBiome;
    const next = renewPool(model, "silver-grass-biomass", "northern-basin", 0n, "summer");
    expect(next).toBeGreaterThan(0n);
  });

  it("leaves a consumable pool unchanged", () => {
    const model = {
      precision: { scale: DEFAULT_SCALE, rounding: "half-even" },
      habitats: {},
      resources: {
        "mineral-salt": { renewable: false, renewalPerTick: 1n },
      },
    } as unknown as CompiledBiome;
    expect(renewPool(model, "mineral-salt", "southern-ridge", 80n, "winter")).toBe(80n);
  });
});
