import { describe, expect, it } from "vitest";
import { DEFAULT_SCALE } from "@biomeweaver/fixed-point";
import { explainFlows, populationFlow } from "./flow.js";

describe("attributed flows", () => {
  it("formats a population decrease with a rule name", () => {
    const flow = populationFlow(
      31,
      "population-decrease",
      "snow-hare",
      "adult",
      "northern-basin",
      7_250_000n,
      DEFAULT_SCALE,
      "resource-deficit-mortality",
      "snow-hare.needs.silver-grass-biomass",
    );
    expect(flow.quantity).toBe("7.250000");
    expect(flow.rule).toBe("snow-hare.needs.silver-grass-biomass");
  });

  it("filters explanation rows by species and tick", () => {
    const flows = [
      populationFlow(
        31,
        "population-decrease",
        "snow-hare",
        "adult",
        "northern-basin",
        1n,
        1n,
        "a",
        "r",
      ),
      populationFlow(
        32,
        "population-decrease",
        "snow-hare",
        "adult",
        "northern-basin",
        1n,
        1n,
        "b",
        "r",
      ),
    ];
    expect(explainFlows(flows, "snow-hare", 31)).toHaveLength(1);
  });
});
