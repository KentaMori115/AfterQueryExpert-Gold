import { describe, expect, it } from "vitest";
import { roundHalfEven } from "./arithmetic.js";
import { assignRemainders, proportionalShares } from "./remainders.js";

describe("roundHalfEven", () => {
  it("leaves an exact quotient unchanged", () => {
    expect(roundHalfEven(10n, 2n)).toBe(5n);
  });

  it("rounds a remainder below half toward zero", () => {
    expect(roundHalfEven(10n, 3n)).toBe(3n);
  });

  it("rounds a remainder above half away from zero", () => {
    expect(roundHalfEven(11n, 3n)).toBe(4n);
  });

  it("rounds an exact half toward the even quotient", () => {
    expect(roundHalfEven(5n, 2n)).toBe(2n);
    expect(roundHalfEven(7n, 2n)).toBe(4n);
  });

  it("preserves sign when rounding a negative exact half", () => {
    expect(roundHalfEven(-5n, 2n)).toBe(-2n);
    expect(roundHalfEven(-7n, 2n)).toBe(-4n);
  });
});

describe("remainder assignment", () => {
  it("splits a leftover unit by stable key order", () => {
    const assigned = assignRemainders(
      [
        { key: "glass-lynx:adult:northern-basin", amount: 10n },
        { key: "snow-hare:adult:northern-basin", amount: 10n },
      ],
      1n,
      ["glass-lynx:adult:northern-basin", "snow-hare:adult:northern-basin"],
    );
    expect(assigned.map((item) => item.amount)).toEqual([11n, 10n]);
  });

  it("walks the same order when several remainder units remain", () => {
    const assigned = assignRemainders(
      [
        { key: "b", amount: 0n },
        { key: "a", amount: 0n },
        { key: "c", amount: 0n },
      ],
      4n,
      ["a", "b", "c"],
    );
    expect(assigned).toEqual([
      { key: "b", amount: 1n },
      { key: "a", amount: 2n },
      { key: "c", amount: 1n },
    ]);
  });

  it("assigns proportional floors and reports the leftover remainder", () => {
    const result = proportionalShares(
      [
        { key: "hare", amount: 2n },
        { key: "beetle", amount: 1n },
      ],
      10n,
    );
    expect(result.assigned.map((item) => item.amount)).toEqual([6n, 3n]);
    expect(result.remainder).toBe(1n);
  });

  it("returns the whole pool as remainder when every weight is zero", () => {
    const result = proportionalShares(
      [
        { key: "hare", amount: 0n },
        { key: "beetle", amount: 0n },
      ],
      5n,
    );
    expect(result.assigned.map((item) => item.amount)).toEqual([0n, 0n]);
    expect(result.remainder).toBe(5n);
  });
});
