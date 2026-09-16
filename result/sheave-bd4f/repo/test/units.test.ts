/**
 * Rounding, and the units a colliery never quite settled on.
 *
 * The shaft is in metres and was sunk in fathoms; the rope is in
 * millimetres and was ordered in inches; the payload is in tonnes and
 * was hoisted in hundredweight. All of them appear on the same sheet,
 * and a quantity without a unit on that sheet is the commonest fault in
 * the subject — so the reader refuses one.
 */

import { describe, expect, it } from "vitest";
import { between, interpolate, near, round, roundDown, roundUp, total } from "../src/units/round.ts";
import {
  FATHOM,
  GRAVITY,
  HORSEPOWER,
  HUNDREDWEIGHT,
  LONG_TON,
  STEEL,
  addsTo,
  addsUp,
  asFathoms,
  asFeetAMinute,
  asHorsepower,
  asHundredweight,
  asTonsForce,
  barMass,
  circleArea,
  forceOf,
  massOf,
  parseForce,
  parseLength,
  parseMass,
  parsePower,
  parseQuantity,
  parseRate,
  parseShare,
  parseSpeed,
  parseTime,
  perShift,
  weightOf,
} from "../src/units/measure.ts";
import { WindingError } from "../src/errors.ts";

describe("rounding", () => {
  it("rounds a half away from zero, both ways", () => {
    expect(round(2.5)).toBe(3);
    expect(round(-2.5)).toBe(-3);
    expect(round(0.125, 2)).toBe(0.13);
    expect(round(-0.125, 2)).toBe(-0.13);
  });

  it("never gives back a negative nought", () => {
    expect(Object.is(round(-0.0004, 2), 0)).toBe(true);
    expect(Object.is(roundDown(-0.0004, 2), 0)).toBe(true);
    expect(1 / round(-0.0004, 2)).toBe(Number.POSITIVE_INFINITY);
  });

  it("rounds away from zero for a thing somebody must have all of", () => {
    expect(roundUp(1.0001, 2)).toBe(1.01);
    expect(roundUp(-0.0004, 2)).toBe(-0.01);
    expect(roundDown(1.0099, 2)).toBe(1);
  });

  it("normalises between two figures rather than clamping", () => {
    expect(between(600, 400, 800)).toBe(0.5);
    expect(between(900, 400, 800)).toBeGreaterThan(1);
  });

  it("interpolates, compares and totals", () => {
    expect(interpolate(600, 400, 800, 20, 40)).toBe(30);
    expect(near(1 / 3, 0.333_333_4, 1e-6)).toBe(true);
    expect(total([1, 2, 3.5])).toBe(6.5);
  });

  it("refuses a figure that is not a figure", () => {
    expect(() => round(Number.NaN)).toThrow(WindingError);
  });
});

describe("reading a quantity", () => {
  it("takes the units a winding sheet is written in", () => {
    expect(parseLength("40mm")).toBeCloseTo(0.04, 6);
    expect(parseLength("2in")).toBeCloseTo(0.0508, 6);
    expect(parseLength("500fm")).toBeCloseTo(500 * FATHOM, 3);
    expect(parseMass("12t")).toBe(12_000);
    expect(parseMass("20cwt")).toBeCloseTo(LONG_TON, 3);
    expect(parseSpeed("600fpm")).toBeCloseTo(3.048, 4);
    expect(parsePower("1000hp")).toBeCloseTo(1000 * HORSEPOWER, 3);
    expect(parseForce("100tonf")).toBeGreaterThan(990);
    expect(parseTime("90min")).toBe(5400);
    expect(parseRate("2400tpd")).toBe(100);
  });

  it("takes a bare number for a share and for nothing else", () => {
    expect(parseShare("4.5")).toBe(4.5);
    expect(parseShare("4.5%")).toBe(4.5);
    expect(() => parseMass("12")).toThrow(WindingError);
    expect(() => parseLength("40")).toThrow(WindingError);
  });

  it("does not read a number as though it were a unit", () => {
    expect(() => parseQuantity("10500")).toThrow(WindingError);
    expect(parseQuantity("10500kg").canonical).toBe(10_500);
  });

  it("refuses a unit of the wrong dimension", () => {
    expect(() => parseMass("40mm")).toThrow(/mass/);
    expect(() => parseSpeed("12t")).toThrow(/speed/);
  });

  it("says which units it knows when it is given one it does not", () => {
    expect(() => parseMass("5stone")).toThrow(/stone/);
  });
});

describe("weights and forces", () => {
  it("turns a mass into a weight and back", () => {
    expect(weightOf(1000)).toBeCloseTo(GRAVITY, 4);
    expect(massOf(weightOf(12_000))).toBeCloseTo(12_000, 3);
  });

  it("refuses a negative mass and allows a signed difference", () => {
    expect(() => weightOf(-1)).toThrow(WindingError);
    expect(forceOf(-1000)).toBeCloseTo(-GRAVITY, 4);
    expect(forceOf(1000)).toBeCloseTo(weightOf(1000), 6);
  });

  it("says a force in the maker's tons force", () => {
    expect(asTonsForce(weightOf(LONG_TON))).toBeCloseTo(1, 3);
  });
});

describe("the conversions the trade still uses", () => {
  it("gives fathoms, feet a minute, horsepower and hundredweight", () => {
    expect(asFathoms(FATHOM)).toBeCloseTo(1, 3);
    expect(asFeetAMinute(0.3048 / 60)).toBeCloseTo(1, 3);
    expect(asHorsepower(HORSEPOWER)).toBeCloseTo(1, 3);
    expect(asHundredweight(HUNDREDWEIGHT)).toBeCloseTo(1, 3);
  });

  it("agrees with itself both ways", () => {
    expect(asFathoms(942)).toBeGreaterThan(500);
    expect(asFathoms(942)).toBeLessThan(520);
  });
});

describe("the small geometry everything leans on", () => {
  it("takes the area from the diameter and not the radius", () => {
    expect(circleArea(40)).toBeCloseTo(Math.PI * 400, 3);
    expect(circleArea(80)).toBeCloseTo(4 * circleArea(40), 3);
  });

  it("weighs a bar of steel", () => {
    expect(barMass(40)).toBeCloseTo((circleArea(40) * 1e-6 * STEEL), 6);
    expect(barMass(40)).toBeGreaterThan(9);
    expect(barMass(40)).toBeLessThan(10);
  });

  it("refuses a diameter of nothing", () => {
    expect(() => circleArea(0)).toThrow(WindingError);
  });
});

describe("shares and shifts", () => {
  it("adds shares up and says whether they close", () => {
    expect(addsTo({ a: 60, b: 40 })).toBe(100);
    expect(addsUp({ a: 60, b: 40 })).toBe(true);
    expect(addsUp({ a: 60, b: 30 })).toBe(false);
  });

  it("splits a day between whole shifts", () => {
    expect(perShift(5557.2, 3)).toBeCloseTo(1852.4, 3);
    expect(() => perShift(100, 2.5)).toThrow(WindingError);
  });
});
