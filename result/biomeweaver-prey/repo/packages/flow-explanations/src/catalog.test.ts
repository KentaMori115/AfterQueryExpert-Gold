import { describe, expect, it } from "vitest";
import { DEFAULT_SCALE } from "@biomeweaver/fixed-point";
import { explainFlows, populationFlow, resourceFlow } from "./flow.js";

describe("flow catalog", () => {
  it.each([
    ["baseline-mortality", "snow-hare.mortality.adult"],
    ["resource-deficit-mortality", "snow-hare.needs.silver-grass-biomass"],
    ["authored-predation", "glass-lynx.predation.snow-hare"],
    ["reproduction", "snow-hare.reproduction"],
    ["initial-state", "scenario.baseline"],
    ["resource-renewal", "silver-grass-biomass.renewalPerTick"],
    ["resource-allocation", "silver-grass-biomass.allocation"],
    ["fixed-event", "events.winter-extension"],
  ])("records cause %s", (cause, rule) => {
    const flow = populationFlow(
      1,
      "population-decrease",
      "snow-hare",
      "adult",
      "northern-basin",
      1n,
      1n,
      cause,
      rule,
    );
    expect(flow.cause).toBe(cause);
    expect(flow.rule).toBe(rule);
  });

  it.each(["population-increase", "population-decrease"] as const)("uses kind %s", (kind) => {
    expect(
      populationFlow(1, kind, "snow-hare", "adult", "northern-basin", 2n, DEFAULT_SCALE, "x", "y")
        .kind,
    ).toBe(kind);
  });

  it.each(["resource-increase", "resource-decrease"] as const)("uses resource kind %s", (kind) => {
    expect(
      resourceFlow(1, kind, "fresh-water", "ice-river", 3n, DEFAULT_SCALE, "x", "y").resource,
    ).toBe("fresh-water");
  });

  it("returns no rows for an unmatched explanation query", () => {
    expect(explainFlows([], "snow-hare", 31)).toEqual([]);
  });
});
