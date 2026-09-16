import { describe, expect, it } from "vitest";
import {
  add,
  clampNonNegative,
  compare,
  div,
  max,
  min,
  mul,
  neg,
  roundHalfEven,
  sub,
} from "./arithmetic.js";
import { parseFixed } from "./parse.js";
import { DEFAULT_SCALE } from "./types.js";

describe("fixed-point arithmetic", () => {
  it("adds two scaled values without rescaling", () => {
    expect(add(parseFixed("1.5", DEFAULT_SCALE), parseFixed("2.25", DEFAULT_SCALE))).toBe(
      parseFixed("3.75", DEFAULT_SCALE),
    );
  });

  it("subtracts two scaled values", () => {
    expect(sub(parseFixed("3.75", DEFAULT_SCALE), parseFixed("1.50", DEFAULT_SCALE))).toBe(
      parseFixed("2.25", DEFAULT_SCALE),
    );
  });

  it("negates a scaled value", () => {
    expect(neg(parseFixed("4", DEFAULT_SCALE))).toBe(parseFixed("-4", DEFAULT_SCALE));
  });

  it("multiplies with half-even rounding back to scale", () => {
    const left = parseFixed("0.12", DEFAULT_SCALE);
    const right = parseFixed("850", DEFAULT_SCALE);
    expect(mul(left, right, DEFAULT_SCALE, "half-even")).toBe(parseFixed("102", DEFAULT_SCALE));
  });

  it("divides with half-even rounding back to scale", () => {
    expect(
      div(
        parseFixed("102", DEFAULT_SCALE),
        parseFixed("850", DEFAULT_SCALE),
        DEFAULT_SCALE,
        "half-even",
      ),
    ).toBe(parseFixed("0.12", DEFAULT_SCALE));
  });

  it("compares values in stable numeric order", () => {
    expect(compare(1n, 2n)).toBe(-1);
    expect(compare(2n, 2n)).toBe(0);
    expect(compare(3n, 2n)).toBe(1);
  });

  it("returns min and max without depending on argument order", () => {
    expect(min(8n, 3n)).toBe(3n);
    expect(max(8n, 3n)).toBe(8n);
  });

  it("clamps negative quantities to zero", () => {
    expect(clampNonNegative(-12n)).toBe(0n);
    expect(clampNonNegative(12n)).toBe(12n);
  });

  it("rejects division by zero", () => {
    expect(() => roundHalfEven(1n, 0n)).toThrow(/division by zero/);
  });
});
