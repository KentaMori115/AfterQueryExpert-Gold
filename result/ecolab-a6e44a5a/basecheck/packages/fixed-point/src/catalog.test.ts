import { describe, expect, it } from "vitest";
import { add, compare, div, formatFixed, mul, parseFixed, sub } from "./index.js";
import { DEFAULT_SCALE } from "./types.js";

describe("fixed-point catalog", () => {
  it.each([
    ["0.000001", 1n],
    ["1.000000", 1_000_000n],
    ["10.500000", 10_500_000n],
    ["100", 100_000_000n],
    ["0.12", 120_000n],
    ["0.04", 40_000n],
    ["0.008", 8_000n],
    ["0.012", 12_000n],
    ["850", 850_000_000n],
    ["9000", 9_000_000_000n],
  ])("parses %s", (text, expected) => {
    expect(parseFixed(text, DEFAULT_SCALE)).toBe(expected);
  });

  it.each([
    [1n, "0.000001"],
    [1_000_000n, "1.000000"],
    [7_250_000n, "7.250000"],
    [0n, "0.000000"],
  ])("formats %s", (value, expected) => {
    expect(formatFixed(value, DEFAULT_SCALE)).toBe(expected);
  });

  it.each([
    ["1", "2", "3"],
    ["0.12", "0.08", "0.20"],
    ["850", "40", "890"],
  ])("adds %s and %s", (left, right, expected) => {
    expect(add(parseFixed(left, DEFAULT_SCALE), parseFixed(right, DEFAULT_SCALE))).toBe(
      parseFixed(expected, DEFAULT_SCALE),
    );
  });

  it.each([
    ["3", "1", "2"],
    ["9000", "400", "8600"],
  ])("subtracts %s and %s", (left, right, expected) => {
    expect(sub(parseFixed(left, DEFAULT_SCALE), parseFixed(right, DEFAULT_SCALE))).toBe(
      parseFixed(expected, DEFAULT_SCALE),
    );
  });

  it.each([
    ["2", "3", "6"],
    ["0.12", "10", "1.20"],
  ])("multiplies %s and %s", (left, right, expected) => {
    expect(
      mul(
        parseFixed(left, DEFAULT_SCALE),
        parseFixed(right, DEFAULT_SCALE),
        DEFAULT_SCALE,
        "half-even",
      ),
    ).toBe(parseFixed(expected, DEFAULT_SCALE));
  });

  it.each([
    ["6", "3", "2"],
    ["1.20", "10", "0.12"],
  ])("divides %s by %s", (left, right, expected) => {
    expect(
      div(
        parseFixed(left, DEFAULT_SCALE),
        parseFixed(right, DEFAULT_SCALE),
        DEFAULT_SCALE,
        "half-even",
      ),
    ).toBe(parseFixed(expected, DEFAULT_SCALE));
  });

  it.each([
    [1n, 2n, -1],
    [2n, 2n, 0],
    [3n, 2n, 1],
  ])("compares %s to %s", (left, right, expected) => {
    expect(compare(left, right)).toBe(expected);
  });
});
