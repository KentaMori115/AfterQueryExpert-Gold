import { describe, expect, it } from "vitest";
import { DEFAULT_SCALE } from "@biomeweaver/fixed-point";
import { overrideApplies, overridesFor, scaleModifier } from "./modifiers.js";

const half = { key: "fresh-water-growth", factor: 500_000n };
const third = {
  key: "fresh-water-growth",
  factor: 333_333n,
  region: "northern-basin",
};

describe("modifier overrides", () => {
  it("covers every region when it names none", () => {
    expect(overrideApplies(half, "ice-river", "fresh-water-growth")).toBe(true);
  });

  it("stays out of a region it does not name", () => {
    expect(overrideApplies(third, "ice-river", "fresh-water-growth")).toBe(false);
  });

  it("ignores a key it does not name", () => {
    expect(overrideApplies(half, "northern-basin", "mineral-salt-growth")).toBe(false);
  });

  it("selects the overrides covering one region and key", () => {
    expect(overridesFor([half, third], "northern-basin", "fresh-water-growth")).toHaveLength(2);
  });

  it("leaves a base factor alone when nothing covers it", () => {
    expect(
      scaleModifier(1_400_000n, [third], "ice-river", "fresh-water-growth", DEFAULT_SCALE),
    ).toBe(1_400_000n);
  });

  it("multiplies two overlapping windows in order", () => {
    expect(
      scaleModifier(
        1_400_000n,
        [half, third],
        "northern-basin",
        "fresh-water-growth",
        DEFAULT_SCALE,
      ),
    ).toBe(233_333n);
  });
});
