import { describe, expect, it } from "vitest";
import { formatFixed, parseFixed } from "./parse.js";
import { DEFAULT_SCALE, FixedPointError } from "./types.js";

describe("parseFixed", () => {
  it("parses a whole number into scaled units", () => {
    expect(parseFixed("12", DEFAULT_SCALE)).toBe(12_000_000n);
  });

  it("parses a fractional value at the declared scale", () => {
    expect(parseFixed("0.12", DEFAULT_SCALE)).toBe(120_000n);
  });

  it("parses a signed value", () => {
    expect(parseFixed("-7.250000", DEFAULT_SCALE)).toBe(-7_250_000n);
  });

  it("accepts a leading plus", () => {
    expect(parseFixed("+3.5", DEFAULT_SCALE)).toBe(3_500_000n);
  });

  it("rejects an empty literal", () => {
    expect(() => parseFixed("   ", DEFAULT_SCALE)).toThrow(FixedPointError);
  });

  it("rejects extra characters", () => {
    expect(() => parseFixed("1.2x", DEFAULT_SCALE)).toThrow(/invalid fixed-point/);
  });

  it("rejects more fractional digits than the scale allows", () => {
    expect(() => parseFixed("1.0000001", DEFAULT_SCALE)).toThrow(/fractional digits/);
  });

  it("rejects a non-power-of-ten scale", () => {
    expect(() => parseFixed("1", 12n)).toThrow(/power of ten/);
  });
});

describe("formatFixed", () => {
  it("formats a scaled value with fixed fractional width", () => {
    expect(formatFixed(7_250_000n, DEFAULT_SCALE)).toBe("7.250000");
  });

  it("formats a negative value", () => {
    expect(formatFixed(-1n, DEFAULT_SCALE)).toBe("-0.000001");
  });

  it("round-trips a parsed literal", () => {
    const value = parseFixed("850.000000", DEFAULT_SCALE);
    expect(formatFixed(value, DEFAULT_SCALE)).toBe("850.000000");
  });
});
