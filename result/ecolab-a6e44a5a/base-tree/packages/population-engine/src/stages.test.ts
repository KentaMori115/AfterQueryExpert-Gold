import { describe, expect, it } from "vitest";
import { advanceStage, applyReproduction } from "./cohorts.js";
import { DEFAULT_SCALE } from "@biomeweaver/fixed-point";

describe("life stages", () => {
  it("keeps a juvenile in place before the authored delay", () => {
    const next = advanceStage(
      {
        species: "snow-hare",
        stage: "juvenile",
        region: "northern-basin",
        count: 10n,
        condition: DEFAULT_SCALE,
        ageTicks: 3,
      },
      8,
      "adult",
    );
    expect(next.stage).toBe("juvenile");
    expect(next.ageTicks).toBe(4);
  });

  it("promotes a juvenile after the authored delay", () => {
    const next = advanceStage(
      {
        species: "snow-hare",
        stage: "juvenile",
        region: "northern-basin",
        count: 10n,
        condition: DEFAULT_SCALE,
        ageTicks: 7,
      },
      8,
      "adult",
    );
    expect(next.stage).toBe("adult");
    expect(next.ageTicks).toBe(0);
  });

  it("creates juvenile offspring from a healthy adult", () => {
    const born = applyReproduction(
      {
        species: "snow-hare",
        stage: "adult",
        region: "northern-basin",
        count: 850_000_000n,
        condition: DEFAULT_SCALE,
        ageTicks: 0,
      },
      40_000n,
      650_000n,
      "juvenile",
      DEFAULT_SCALE,
    );
    expect(born?.offspring.stage).toBe("juvenile");
    expect(born?.births).toBeGreaterThan(0n);
  });
});
