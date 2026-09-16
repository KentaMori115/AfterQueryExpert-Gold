import { describe, expect, it } from "vitest";
import { cohortKey, isIdentifier, poolKey, requireIdentifier } from "./identifiers.js";

describe("identifiers", () => {
  it("accepts lowercase hyphenated ids", () => {
    expect(isIdentifier("snow-hare")).toBe(true);
    expect(isIdentifier("northern-basin")).toBe(true);
  });

  it("rejects uppercase or spaced ids", () => {
    expect(isIdentifier("SnowHare")).toBe(false);
    expect(isIdentifier("snow hare")).toBe(false);
  });

  it("records a diagnostic for an invalid identifier", () => {
    const diagnostics: { code: string }[] = [];
    expect(requireIdentifier("Snow", "species id", "species/x.yaml", diagnostics)).toBeUndefined();
    expect(diagnostics[0]?.code).toBe("BW-ID-001");
  });

  it("builds stable cohort and pool keys", () => {
    expect(cohortKey("snow-hare", "adult", "northern-basin")).toBe(
      "snow-hare:adult:northern-basin",
    );
    expect(poolKey("silver-grass-biomass", "northern-basin")).toBe(
      "silver-grass-biomass:northern-basin",
    );
  });
});
