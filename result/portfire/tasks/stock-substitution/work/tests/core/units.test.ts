import { describe, expect, it } from "vitest";
import {
  addAmperes,
  addMetres,
  addMs,
  amperes,
  feet,
  inches,
  maxMs,
  metres,
  metresPerSecond,
  minMs,
  mm,
  ms,
  nominalCalibre,
  nominalCalibres,
  ohms,
  raw,
  scaleMs,
  seconds,
  subMs,
  toFeet,
  toInches,
  toSeconds,
} from "../../src/core/units.js";

describe("constructors", () => {
  it("keeps the number it was given", () => {
    expect(raw(mm(75))).toBe(75);
    expect(raw(metres(120))).toBe(120);
    expect(raw(amperes(1.2))).toBe(1.2);
    expect(raw(ohms(2.4))).toBe(2.4);
    expect(raw(metresPerSecond(4))).toBe(4);
  });

  it("rejects a negative length", () => {
    expect(() => mm(-1)).toThrow(RangeError);
    expect(() => metres(-0.5)).toThrow(RangeError);
  });

  it("rejects a negative current or resistance", () => {
    expect(() => amperes(-0.1)).toThrow(RangeError);
    expect(() => ohms(-3)).toThrow(RangeError);
    expect(() => metresPerSecond(-2)).toThrow(RangeError);
  });

  it("rejects anything that is not finite", () => {
    expect(() => mm(Number.NaN)).toThrow(/finite/);
    expect(() => ms(Number.POSITIVE_INFINITY)).toThrow(/finite/);
    expect(() => metres(Number.NEGATIVE_INFINITY)).toThrow(/finite/);
  });

  it("allows a negative millisecond value", () => {
    expect(raw(ms(-2400))).toBe(-2400);
  });

  it("names the unit in the message", () => {
    expect(() => mm(-1)).toThrow(/millimetre/);
    expect(() => amperes(-1)).toThrow(/ampere/);
    expect(() => metresPerSecond(-1)).toThrow(/wind speed/);
  });
});

describe("imperial conversions", () => {
  it("converts inches to millimetres", () => {
    expect(raw(inches(3))).toBeCloseTo(76.2, 6);
    expect(raw(inches(2.5))).toBeCloseTo(63.5, 6);
  });

  it("round trips a caliber", () => {
    expect(toInches(inches(4))).toBeCloseTo(4, 9);
  });

  it("converts feet to metres", () => {
    expect(raw(feet(70))).toBeCloseTo(21.336, 6);
  });

  it("round trips a distance", () => {
    expect(toFeet(feet(210))).toBeCloseTo(210, 9);
  });
});

describe("time", () => {
  it("converts seconds to milliseconds", () => {
    expect(raw(seconds(2.4))).toBeCloseTo(2400, 9);
    expect(toSeconds(ms(1500))).toBeCloseTo(1.5, 9);
  });

  it("adds and subtracts", () => {
    expect(raw(addMs(ms(1200), ms(300)))).toBe(1500);
    expect(raw(subMs(ms(1200), ms(1500)))).toBe(-300);
  });

  it("scales", () => {
    expect(raw(scaleMs(ms(400), 2.5))).toBe(1000);
  });

  it("rejects a scale factor that is not finite", () => {
    expect(() => scaleMs(ms(400), Number.NaN)).toThrow(/scale factor/);
  });

  it("picks the largest and smallest", () => {
    expect(raw(maxMs(ms(100), ms(-400), ms(250)))).toBe(250);
    expect(raw(minMs(ms(100), ms(-400), ms(250)))).toBe(-400);
  });

  it("refuses an empty comparison", () => {
    expect(() => maxMs()).toThrow(/at least one/);
    expect(() => minMs()).toThrow(/at least one/);
  });
});

describe("aggregates", () => {
  it("adds lengths and currents", () => {
    expect(raw(addMetres(metres(30), metres(12.5)))).toBe(42.5);
    expect(raw(addAmperes(amperes(0.8), amperes(0.4)))).toBeCloseTo(1.2, 9);
  });
});

describe("nominal calibers", () => {
  it("snaps a converted inch size onto the mortar size", () => {
    expect(raw(nominalCalibre(inches(3)))).toBe(75);
    expect(raw(nominalCalibre(inches(2.5)))).toBe(63);
    expect(raw(nominalCalibre(inches(6)))).toBe(150);
  });

  it("snaps a value that already sits on a size to itself", () => {
    expect(raw(nominalCalibre(mm(100)))).toBe(100);
  });

  it("clamps below the smallest and above the largest", () => {
    expect(raw(nominalCalibre(mm(5)))).toBe(25);
    expect(raw(nominalCalibre(mm(900)))).toBe(400);
  });

  it("lists the sizes in ascending order", () => {
    const sizes = nominalCalibres().map(raw);
    expect(sizes.length).toBeGreaterThan(10);
    expect([...sizes].sort((a, b) => a - b)).toEqual(sizes);
  });
});
