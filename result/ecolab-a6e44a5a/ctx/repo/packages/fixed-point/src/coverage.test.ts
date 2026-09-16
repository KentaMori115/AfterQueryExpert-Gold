import { describe, expect, it } from "vitest";
import { div, mul } from "./arithmetic.js";
import { formatFixed, parseFixed } from "./parse.js";
import { assignRemainders } from "./remainders.js";
import { DEFAULT_SCALE, FixedPointError } from "./types.js";

describe("fixed-point unit coverage", () => {
  it("parses zero with and without a fraction", () => {
    expect(parseFixed("0", DEFAULT_SCALE)).toBe(0n);
    expect(parseFixed("0.000000", DEFAULT_SCALE)).toBe(0n);
  });

  it("formats zero with the full fractional width", () => {
    expect(formatFixed(0n, DEFAULT_SCALE)).toBe("0.000000");
  });

  it("multiplies by zero without leftover units", () => {
    expect(mul(parseFixed("0.12", DEFAULT_SCALE), 0n, DEFAULT_SCALE, "half-even")).toBe(0n);
  });

  it("divides a tiny quantity without producing a negative", () => {
    expect(
      div(1n, parseFixed("3", DEFAULT_SCALE), DEFAULT_SCALE, "half-even"),
    ).toBeGreaterThanOrEqual(0n);
  });

  it("rejects an unknown rounding mode", () => {
    expect(() => mul(1n, 1n, DEFAULT_SCALE, "half-up" as unknown as "half-even")).toThrow(
      FixedPointError,
    );
  });

  it("leaves shares unchanged when the remainder is zero", () => {
    const shares = assignRemainders([{ key: "snow-hare:adult:northern-basin", amount: 4n }], 0n, [
      "snow-hare:adult:northern-basin",
    ]);
    expect(shares).toEqual([{ key: "snow-hare:adult:northern-basin", amount: 4n }]);
  });

  it("falls back to lexical order when a key is missing from the rank list", () => {
    const shares = assignRemainders(
      [
        { key: "zeta", amount: 0n },
        { key: "alpha", amount: 0n },
      ],
      1n,
      [],
    );
    expect(shares[0]?.amount).toBe(0n);
    expect(shares[1]?.amount).toBe(1n);
  });
});
