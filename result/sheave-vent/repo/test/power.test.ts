/**
 * What the engine does, and what it has to be rated at.
 *
 * A winder's peak load lasts fifteen seconds and its cycle lasts two
 * minutes, so a motor rated at the peak is three times the motor the
 * duty needs. And the rope is as large an out-of-balance as the payload
 * on a deep shaft, which is what a balance rope is for and what these
 * tests are mostly about.
 */

import { describe, expect, it } from "vitest";
import {
  accelerationForce,
  atEnd,
  atStart,
  balanceWanted,
  describeDuty,
  duty,
  energyPerTonne,
  energyPerWind,
  force,
  motorFor,
  movingMass,
  outOfBalance,
  overloadRatio,
  peakPower,
  powerAt,
  regenerated,
  regeneratedShare,
  rmsPower,
  ropeBalanced,
  ropeMetre,
  swing,
  windLasts,
} from "../src/power/duty.ts";
import { rope } from "../src/rope/index.ts";
import { conveyance, skip } from "../src/cage/index.ts";
import { profile, windTime } from "../src/cycle/index.ts";
import { WindingError } from "../src/errors.ts";

const line = rope(52);
const how = profile();
const loaded = skip(12_000);
const empty = conveyance({ name: "empty", kind: "skip", tare: loaded.tare, payload: 0, decks: 1, width: 2.2, across: 1.8 });
const bare = duty({ rising: loaded, falling: empty, rope: line, depth: 942 });
const balanced = duty({ ...bare, balance: balanceWanted(bare) });

describe("the out-of-balance", () => {
  it("swings the whole weight of the rope, twice over, with no balance rope", () => {
    expect(swing(bare)).toBeCloseTo(2 * ropeMetre(bare) * 942 * 0.00980665, 2);
    expect(atStart(bare)).toBeGreaterThan(atEnd(bare));
  });

  it("is as large as the payload on a deep shaft", () => {
    expect(swing(bare)).toBeGreaterThan(0.5 * 12_000 * 0.00980665);
  });

  it("goes to nothing with a matched balance rope", () => {
    expect(swing(balanced)).toBeLessThan(0.01);
    expect(atStart(balanced)).toBeCloseTo(atEnd(balanced), 2);
    expect(ropeBalanced(balanced)).toBe(true);
    expect(ropeBalanced(bare)).toBe(false);
  });

  it("moves smoothly through the wind and not in steps", () => {
    const found = [1, 0.75, 0.5, 0.25, 0].map((at) => outOfBalance(bare, 942 * at));
    for (let at = 1; at < found.length; at += 1) {
      expect((found[at] as number)).toBeLessThan(found[at - 1] as number);
    }
  });

  it("goes negative at the end on a cage winder, where the rope drives", () => {
    const cages = duty({ rising: conveyance(), falling: conveyance({ payload: 0 }), rope: line, depth: 942 });
    expect(atEnd(cages)).toBeLessThan(0);
  });

  it("refuses a position off the wind", () => {
    expect(() => outOfBalance(bare, 1200)).toThrow(WindingError);
  });
});

describe("the power", () => {
  it("counts the rotating parts as well as everything hanging", () => {
    expect(movingMass(bare)).toBeGreaterThan(loaded.tare + loaded.payload + empty.tare);
    expect(accelerationForce(bare, 1)).toBeCloseTo(movingMass(bare) / 1000, 3);
  });

  it("puts the r.m.s. well below the peak", () => {
    expect(rmsPower(bare, how)).toBeLessThan(peakPower(bare, how));
    expect(overloadRatio(bare, how)).toBeGreaterThan(1.5);
    expect(overloadRatio(bare, how)).toBeLessThan(4);
  });

  it("rates the motor above the r.m.s. and below the peak", () => {
    const rated = motorFor(bare, how);
    expect(rated).toBeGreaterThan(rmsPower(bare, how));
    expect(rated).toBeLessThan(peakPower(bare, how));
  });

  it("lowers both the peak and the overload with a balance rope", () => {
    expect(peakPower(balanced, how)).toBeLessThan(peakPower(bare, how));
    expect(overloadRatio(balanced, how)).toBeLessThan(overloadRatio(bare, how));
  });

  it("gives the power at any point of the wind", () => {
    expect(powerAt(bare, 942, 1, 15)).toBeGreaterThan(powerAt(bare, 0, 1, 15));
    expect(powerAt(bare, 942, 0, 0)).toBe(0);
  });

  it("lasts as long as the cycle module says it does", () => {
    expect(windLasts(bare, how)).toBeCloseTo(windTime(how, 942), 3);
  });
});

describe("the energy", () => {
  it("comes to a little over the theoretical lift", () => {
    const ideal = (12_000 * 9.80665 * 942) / 1000 / 3600;
    expect(energyPerWind(bare)).toBeGreaterThan(ideal);
    expect(energyPerWind(bare)).toBeLessThan(ideal * 1.4);
  });

  it("is the same balanced or not, because a balance rope does no work", () => {
    expect(energyPerWind(balanced)).toBeCloseTo(energyPerWind(bare), 6);
  });

  it("spreads over the payload", () => {
    expect(energyPerTonne(bare)).toBeCloseTo(energyPerWind(bare) / 12, 4);
  });

  it("gives back only the kinetic energy on the brake", () => {
    expect(regeneratedShare(bare, how)).toBeGreaterThan(0.01);
    expect(regeneratedShare(bare, how)).toBeLessThan(0.15);
    expect(regenerated(bare, how)).toBeLessThan(energyPerWind(bare));
  });

  it("refuses to spread the energy over nothing", () => {
    const nothing = duty({ rising: conveyance({ payload: 0 }), falling: conveyance({ payload: 0 }), rope: line, depth: 942 });
    expect(() => energyPerTonne(nothing)).toThrow(WindingError);
  });

  it("describes itself in a line", () => {
    expect(describeDuty(bare, how)).toContain("r.m.s.");
    expect(force(bare, 942, 1)).toBeGreaterThan(atStart(bare));
  });
});
