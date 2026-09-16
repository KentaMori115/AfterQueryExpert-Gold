import { describe, expect, it } from "vitest";
import { compileCapsule } from "@biomeweaver/biome-model";
import { completeBiome } from "../../../ecosystem-lab/helpers/paths.js";
import { firingEffects, spreadQuantity, targetPools } from "./events.js";
import { initialPools } from "./state.js";

const compiled = compileCapsule({ root: completeBiome("crystal-tundra") });
const model = compiled.model!;

describe("fixed events", () => {
  it("fires a hook on its own tick", () => {
    const scenario = model.scenarios["long-winter"]!;
    expect(firingEffects(model, scenario, 30)).toHaveLength(1);
  });

  it("leaves a one tick window closed on the tick after", () => {
    const scenario = model.scenarios["long-winter"]!;
    expect(firingEffects(model, scenario, 31)).toEqual([]);
  });

  it("reaches every pool of a resource when no region is named", () => {
    const pools = [
      { resource: "fresh-water", region: "ice-river", quantity: 1n },
      { resource: "fresh-water", region: "northern-basin", quantity: 1n },
      { resource: "mineral-salt", region: "southern-ridge", quantity: 1n },
    ];
    const effect = { resource: "fresh-water", quantity: -1n, forTicks: 1 };
    expect(targetPools(pools, effect)).toHaveLength(2);
  });

  it("narrows to the region an effect names", () => {
    const pools = initialPools(model.scenarios["baseline"]!);
    const effect = {
      resource: "fresh-water",
      region: "ice-river",
      quantity: -1n,
      forTicks: 1,
    };
    const indices = targetPools(pools, effect);
    expect(indices.map((index) => pools[index]?.region)).toEqual(["ice-river"]);
  });

  it("splits a quantity in proportion to what each pool holds", () => {
    const pools = [
      { resource: "fresh-water", region: "ice-river", quantity: 3_000_000n },
      { resource: "fresh-water", region: "northern-basin", quantity: 9_000_000n },
    ];
    const shares = spreadQuantity(pools, [0, 1], 400_000_000n);
    expect(shares.get(0)).toBe(100_000_000n);
    expect(shares.get(1)).toBe(300_000_000n);
  });

  it("splits evenly when the pools hold nothing", () => {
    const pools = [
      { resource: "fresh-water", region: "ice-river", quantity: 0n },
      { resource: "fresh-water", region: "northern-basin", quantity: 0n },
    ];
    const shares = spreadQuantity(pools, [0, 1], 7n);
    expect([shares.get(0), shares.get(1)]).toEqual([4n, 3n]);
  });
});
