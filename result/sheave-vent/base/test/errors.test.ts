/**
 * The one error this library throws, and the guards that throw it.
 *
 * Every refusal carries the name of the quantity that was wrong. On a
 * winding sheet there are thirty figures — the depth, the rope
 * diameter, the drum diameter, the payload, the speed, half a dozen
 * masses — and "that is not a number" is not a message.
 */

import { describe, expect, it } from "vitest";
import {
  WindingError,
  choose,
  count,
  depth,
  factor,
  insist,
  nonNegative,
  percentage,
  positive,
  real,
  share,
  speed,
  within,
} from "../src/errors.ts";

describe("the error", () => {
  it("carries the quantity that was wrong", () => {
    const thrown = new WindingError("that will not do", "diameter");
    expect(thrown.quantity).toBe("diameter");
    expect(thrown).toBeInstanceOf(Error);
    expect(thrown.name).toBe("WindingError");
  });

  it("is what every guard throws", () => {
    const guards: Array<() => unknown> = [
      () => real(Number.NaN),
      () => positive(0),
      () => nonNegative(-1),
      () => within(5, 10, 20),
      () => percentage(140),
      () => share(1.4),
      () => count(1.5),
      () => depth(5000),
      () => speed(40),
      () => factor(0.9),
      () => insist(false, "no"),
    ];
    for (const each of guards) expect(each).toThrow(WindingError);
  });
});

describe("what each guard allows", () => {
  it("lets a real number through and stops the others", () => {
    expect(real(3.4)).toBe(3.4);
    expect(() => real(Number.POSITIVE_INFINITY)).toThrow(WindingError);
  });

  it("tells positive from non-negative", () => {
    expect(nonNegative(0)).toBe(0);
    expect(() => positive(0)).toThrow(WindingError);
    expect(positive(0.001)).toBe(0.001);
  });

  it("takes a percentage up to a hundred and a share up to one", () => {
    expect(percentage(100)).toBe(100);
    expect(share(1)).toBe(1);
    expect(() => percentage(100.5)).toThrow(WindingError);
    expect(() => share(1.5)).toThrow(WindingError);
  });

  it("takes a depth no deeper than anything ever sunk", () => {
    expect(depth(0)).toBe(0);
    expect(depth(4000)).toBe(4000);
    expect(() => depth(-1)).toThrow(WindingError);
  });

  it("takes a speed no faster than anything has been wound", () => {
    expect(speed(15)).toBe(15);
    expect(speed(0)).toBe(0);
    expect(() => speed(30)).toThrow(WindingError);
  });

  it("will not call a number below one a factor of safety", () => {
    expect(factor(8)).toBe(8);
    expect(() => factor(1)).toThrow(/not a factor of safety/);
  });

  it("takes a whole number where a count is wanted", () => {
    expect(count(42)).toBe(42);
    expect(() => count(-1)).toThrow(WindingError);
  });

  it("keeps a band in the right order", () => {
    expect(within(15, 10, 20)).toBe(15);
    expect(() => within(15, 20, 10)).toThrow(WindingError);
  });

  it("names one of a fixed set of words", () => {
    expect(choose("drum", ["drum", "koepe"], "drive")).toBe("drum");
    expect(() => choose("winch", ["drum", "koepe"], "drive")).toThrow(/drum/);
  });

  it("says what was wrong and about what", () => {
    try {
      within(5000, 0, 4200, "shaft depth");
      expect.unreachable();
    } catch (thrown) {
      expect(thrown).toBeInstanceOf(WindingError);
      expect((thrown as WindingError).quantity).toBe("shaft depth");
      expect((thrown as WindingError).message).toContain("4200");
    }
  });
});
