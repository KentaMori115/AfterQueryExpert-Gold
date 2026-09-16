/**
 * A wind that is stopped, and what the rope makes of it.
 *
 * The arithmetic is short and the trap in it is not. A retardation put
 * on the drum does not raise the rope's tension by mass times
 * retardation; it raises it by that and then the conveyance swings past
 * by as much again, and the rope carries the sum. Which way that lands
 * depends on which way the conveyance was going, and the case that
 * breaks ropes is the one where it was going down.
 *
 * The mass that matters here is the swinging one and not everything
 * hanging in the shaft, so every case below is arranged to fail if the
 * two are confused.
 */

import { describe, expect, it } from "vitest";
import { hang, bounceMass, goesSlack, leastPull, peakPull, shockFactor } from "../../src/rope/index.ts";
import { breakingLoad, constructionNamed, massPerMetre, rope } from "../../src/rope/construction.ts";
import { weightOf } from "../../src/units/measure.ts";
import { ARRESTOR, EMERGENCY_BRAKE } from "../../src/safety/gear.ts";

const winding = rope(52, constructionNamed("6x36"), 1960);
const deep = hang({ rope: winding, length: 984, ropes: 1, carried: 17_040, balance: 0 });
const balanced = hang({ rope: winding, length: 42, ropes: 1, carried: 17_040, balance: 9_363 });
const set = hang({ rope: rope(42, constructionNamed("6x36"), 1960), length: 1145, ropes: 4, carried: 28_400, balance: 0 });

function hanging(one: ReturnType<typeof hang>): number {
  return weightOf(one.carried + one.balance + massPerMetre(one.rope) * one.ropes * one.length);
}

describe("what a rising conveyance leaves in the rope when it is stopped", () => {
  it("is what already hung there, plus twice what the retardation asks", () => {
    const wanted = hanging(deep) + (2 * bounceMass(deep) * EMERGENCY_BRAKE) / 1000;
    expect(peakPull(deep, EMERGENCY_BRAKE)).toBeCloseTo(wanted, 2);
  });

  it("doubles what a gentle load of the same size would do", () => {
    const gently = (bounceMass(deep) * EMERGENCY_BRAKE) / 1000;
    expect(peakPull(deep, EMERGENCY_BRAKE) - hanging(deep)).toBeCloseTo(2 * gently, 2);
  });

  it("grows in step with the retardation", () => {
    const once = peakPull(deep, 1) - hanging(deep);
    const thrice = peakPull(deep, 3) - hanging(deep);
    expect(thrice).toBeCloseTo(3 * once, 2);
  });

  it("counts the swinging mass and not the whole rope hanging in the shaft", () => {
    const everything = hanging(deep) + (2 * (deep.carried + massPerMetre(winding) * deep.length) * EMERGENCY_BRAKE) / 1000;
    expect(peakPull(deep, EMERGENCY_BRAKE)).toBeLessThan(everything);
  });

  it("counts every rope of a set in what is being retarded", () => {
    const wanted = hanging(set) + (2 * bounceMass(set) * EMERGENCY_BRAKE) / 1000;
    expect(peakPull(set, EMERGENCY_BRAKE)).toBeCloseTo(wanted, 2);
  });
});

describe("what a falling one leaves in it", () => {
  it("is the same arithmetic taken off instead of put on", () => {
    const wanted = hanging(deep) - (2 * bounceMass(deep) * EMERGENCY_BRAKE) / 1000;
    expect(leastPull(deep, EMERGENCY_BRAKE)).toBeCloseTo(wanted, 2);
  });

  it("is less than what hung there, because holding it back means pulling less", () => {
    expect(leastPull(deep, EMERGENCY_BRAKE)).toBeLessThan(hanging(deep));
  });

  it("is left alone by the emergency brake on an ordinary deep winder", () => {
    expect(leastPull(deep, EMERGENCY_BRAKE)).toBeGreaterThan(0);
    expect(goesSlack(deep, EMERGENCY_BRAKE)).toBe(false);
  });

  it("goes past nothing when the arrestor gear takes it instead", () => {
    expect(leastPull(deep, ARRESTOR)).toBeLessThan(0);
    expect(goesSlack(deep, ARRESTOR)).toBe(true);
  });

  it("stands a harder stop where most of what hangs is the rope's own weight", () => {
    expect(goesSlack(balanced, 5.5)).toBe(true);
    expect(goesSlack(deep, 5.5)).toBe(false);
  });

  it("never goes slack below half of gravity, whatever is on the end of it", () => {
    for (const one of [deep, balanced, set]) {
      expect(goesSlack(one, 4.9)).toBe(false);
    }
  });
});

describe("the factor of safety a stop leaves", () => {
  it("is the breaking load of the whole set over what the rope then carries", () => {
    expect(shockFactor(deep, EMERGENCY_BRAKE)).toBeCloseTo(breakingLoad(winding) / peakPull(deep, EMERGENCY_BRAKE), 3);
  });

  it("counts all four ropes of a set as strength", () => {
    expect(shockFactor(set, EMERGENCY_BRAKE)).toBeCloseTo(
      (4 * breakingLoad(set.rope)) / peakPull(set, EMERGENCY_BRAKE),
      3,
    );
  });

  it("falls as the brake is set harder", () => {
    expect(shockFactor(deep, 4)).toBeLessThan(shockFactor(deep, 2));
  });

  it("leaves an ordinary deep winder above four and a half on the emergency brake", () => {
    expect(shockFactor(deep, EMERGENCY_BRAKE)).toBeGreaterThan(4.5);
  });

  it("takes it well below that on the arrestor gear", () => {
    expect(shockFactor(deep, ARRESTOR)).toBeLessThan(4.5);
  });

  it("is worse on a balanced winder near the bank than on a bare rope there", () => {
    const bare = hang({ ...balanced, balance: 0 });
    expect(shockFactor(balanced, EMERGENCY_BRAKE)).toBeLessThan(shockFactor(bare, EMERGENCY_BRAKE));
  });

  it("counts a balance rope in what hangs and in what swings alike", () => {
    const withRope = hang({ ...deep, balance: 9_000 });
    const wanted = peakPull(deep, EMERGENCY_BRAKE) + weightOf(9_000) + (2 * 9_000 * EMERGENCY_BRAKE) / 1000;
    expect(peakPull(withRope, EMERGENCY_BRAKE)).toBeCloseTo(wanted, 2);
  });
});

describe("the stop taken across a range of brakes", () => {
  it("puts nothing extra in at no retardation at all", () => {
    expect(peakPull(deep, 0.0001)).toBeCloseTo(hanging(deep), 2);
    expect(leastPull(deep, 0.0001)).toBeCloseTo(hanging(deep), 2);
  });

  it("rises without a break as the brake is set harder", () => {
    let last = 0;
    for (const at of [0.5, 1, 2, 2.5, 4, 6, 9.81]) {
      const found = peakPull(deep, at);
      expect(found).toBeGreaterThan(last);
      last = found;
    }
  });

  it("straddles what already hung there, whatever the brake is set to", () => {
    for (const at of [0.5, 2.5, 6]) {
      const middle = (peakPull(deep, at) + leastPull(deep, at)) / 2;
      expect(middle).toBeCloseTo(hanging(deep), 2);
    }
  });

  it("keeps a hang whose rope is nearly all of what hangs on the safe side longer", () => {
    const bare = hang({ rope: winding, length: 2400, ropes: 1, carried: 500, balance: 0 });
    expect(goesSlack(bare, 6)).toBe(false);
    expect(goesSlack(balanced, 6)).toBe(true);
  });
});
