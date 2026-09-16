/**
 * The two ways of driving a rope: coiling it and gripping it.
 *
 * A cylindrical drum has to coil a mile of rope and give it back
 * straight; a friction winder does not coil anything and pays for it in
 * the capstan equation. The tests here are mostly about the two limits
 * that decide which a colliery can use — the fleet angle and the
 * tension ratio.
 */

import { describe, expect, it } from "vitest";
import {
  DEAD_TURNS,
  MOST_FLEET,
  PITCH_OVER_DIAMETER,
  bigEnoughFor,
  capacity,
  crushing,
  deadRope,
  describeDrum,
  diameterFor,
  drum,
  fleetAngle,
  holdsIt,
  layerDiameter,
  layersFor,
  leadFor,
  liesDown,
  revolutions,
  ropeInLayer,
  ropeSpeed,
  speedCreep,
  turnsALayer,
  turnsFor,
} from "../src/drum/cylindrical.ts";
import {
  MOST_PRESSURE,
  ROPE_SHARE_ERROR,
  SLIP_MARGIN,
  balanceRopeFor,
  balancedTensions,
  deepestDriving,
  describeKoepe,
  hangingNeeded,
  koepe,
  leastWheel,
  liningPressure,
  liningStands,
  mostRatio,
  ratioAt,
  tensions,
  wheelBigEnough,
  willDrive,
  workingRatio,
  worstRatio,
  worstRope,
  wrapNeeded,
} from "../src/drum/koepe.ts";
import { constructionNamed, leastDrum, massPerMetre, rope } from "../src/rope/index.ts";
import { conveyance, gross, skip } from "../src/cage/index.ts";
import { weightOf } from "../src/units/measure.ts";
import { WindingError } from "../src/errors.ts";

const line = rope(52);
const one = drum(4.2, 2.4, 2, 46);

describe("the drum", () => {
  it("is large enough for its rope", () => {
    expect(bigEnoughFor(one, line)).toBe(true);
    expect(bigEnoughFor(drum(2.4, 2.4, 2, 46), line)).toBe(false);
    expect(diameterFor(line)).toBeGreaterThanOrEqual(leastDrum(line));
  });

  it("coils at a little more than the rope diameter", () => {
    expect(PITCH_OVER_DIAMETER).toBeGreaterThan(1);
    expect(turnsALayer(one, line)).toBeCloseTo(Math.floor(2.4 / ((52 * PITCH_OVER_DIAMETER) / 1000)), 0);
  });

  it("holds more rope on the second layer than the first", () => {
    expect(ropeInLayer(one, line, 2)).toBeGreaterThan(ropeInLayer(one, line, 1));
    expect(layerDiameter(one, line, 2)).toBeCloseTo(4.2 + (2 * 52) / 1000, 4);
  });

  it("says how many layers a length takes, and whether it holds it", () => {
    expect(layersFor(one, line, 984)).toBe(2);
    expect(holdsIt(one, line, 984)).toBe(true);
    expect(holdsIt(one, line, 4000)).toBe(false);
    expect(capacity(one, line)).toBeGreaterThan(984);
  });

  it("makes the rope speed creep across the layers", () => {
    expect(speedCreep(one, line)).toBeGreaterThan(0);
    expect(ropeSpeed(one, line, 60, 2)).toBeGreaterThan(ropeSpeed(one, line, 60, 1));
  });

  it("crushes the bottom coil harder the more layers there are", () => {
    expect(crushing(drum(4.2, 2.4, 3, 46))).toBeGreaterThan(crushing(one));
    expect(crushing(drum(4.2, 2.4, 1, 46))).toBe(1);
  });

  it("keeps the fleet angle down with a long lead", () => {
    expect(fleetAngle(one)).toBeLessThan(MOST_FLEET);
    expect(liesDown(one)).toBe(true);
    expect(liesDown(drum(4.2, 2.4, 2, 18))).toBe(false);
    expect(leadFor(drum(4.2, 2.4, 2, 18))).toBeGreaterThan(18);
  });

  it("leaves dead turns on and counts the turns a wind takes", () => {
    expect(deadRope(one, line)).toBeCloseTo(DEAD_TURNS * Math.PI * 4.2, 2);
    expect(turnsFor(one, line, 984)).toBeGreaterThan(60);
    expect(revolutions(one, line, 15)).toBeGreaterThan(50);
  });

  it("refuses to pay out more rope than it has", () => {
    // Twelve layers is the most the walk allows, and twelve layers of
    // this drum hold nearly eight kilometres.
    expect(() => turnsFor(one, line, 10_000)).toThrow(WindingError);
    expect(() => layersFor(one, line, 10_000)).toThrow(WindingError);
  });

  it("describes itself in a line", () => {
    expect(describeDrum(one, line)).toContain("fleet angle");
  });
});

describe("the friction winder", () => {
  const wheel = koepe();
  const thin = rope(32);
  const loaded = skip(12_000);
  const empty = conveyance({ name: "empty", kind: "skip", tare: loaded.tare, payload: 0, decks: 1, width: 2.2, across: 1.8 });
  const rising = weightOf(gross(loaded));
  const falling = weightOf(gross(empty));

  it("holds what the capstan equation says and no more", () => {
    expect(mostRatio(wheel)).toBeCloseTo(Math.exp(0.25 * Math.PI), 4);
    expect(workingRatio(wheel)).toBeCloseTo(mostRatio(wheel) / SLIP_MARGIN, 4);
  });

  it("gets more grip from more wrap and more friction alike", () => {
    expect(mostRatio(koepe(5, 210, 0.25, 4))).toBeGreaterThan(mostRatio(wheel));
    expect(mostRatio(koepe(5, 180, 0.32, 4))).toBeGreaterThan(mostRatio(wheel));
  });

  it("is made worse by depth and not better", () => {
    expect(worstRatio(thin, 1500, rising, falling)).toBeGreaterThan(worstRatio(thin, 300, rising, falling));
  });

  it("finds the worst point of the wind rather than guessing at it", () => {
    const ends = Math.max(
      ratioAt(tensions(thin, 900, rising, falling, 0).taut, tensions(thin, 900, rising, falling, 0).slack),
      ratioAt(tensions(thin, 900, rising, falling, 900).taut, tensions(thin, 900, rising, falling, 900).slack),
    );
    expect(worstRatio(thin, 900, rising, falling)).toBeGreaterThanOrEqual(ends - 1e-6);
  });

  it("will not drive skips at any depth without a balance rope", () => {
    expect(deepestDriving(wheel, thin, rising, falling)).toBe(0);
  });

  it("will drive cages to a few hundred metres without one", () => {
    const cage = conveyance();
    const cageEmpty = conveyance({ payload: 0 });
    const found = deepestDriving(wheel, thin, weightOf(gross(cage)), weightOf(gross(cageEmpty)));
    expect(found).toBeGreaterThan(100);
    expect(found).toBeLessThan(1500);
  });

  it("makes the tensions the same at both ends with a balance rope", () => {
    const found = balancedTensions(thin, 900, rising, falling);
    expect(found.taut - found.slack).toBeCloseTo(rising - falling, 3);
    expect(balanceRopeFor(thin)).toBeCloseTo(massPerMetre(thin), 3);
  });

  it("says how much hanging rope the grip actually wants", () => {
    const wanted = hangingNeeded(wheel, 900, rising, falling);
    expect(wanted).toBeGreaterThan(massPerMetre(thin));
    const heavy = { taut: rising + (wanted * 900 * 9.80665) / 1000, slack: falling + (wanted * 900 * 9.80665) / 1000 };
    expect(willDrive(wheel, heavy.taut, heavy.slack)).toBe(true);
  });

  it("says how much wrap would answer instead", () => {
    const found = balancedTensions(thin, 900, rising, falling);
    const wanted = wrapNeeded(wheel, found.taut, found.slack);
    expect(wanted).toBeGreaterThan(wheel.wrap);
  });

  it("refuses to answer a wind that is already balanced", () => {
    expect(() => hangingNeeded(wheel, 900, 100, 100)).toThrow(WindingError);
  });

  it("watches the lining pressure and shares the load unevenly", () => {
    const found = balancedTensions(thin, 900, rising, falling);
    expect(liningPressure(wheel, thin, found.taut, found.slack)).toBeLessThan(MOST_PRESSURE);
    expect(liningStands(wheel, thin, found.taut, found.slack)).toBe(true);
    expect(worstRope(wheel, 400)).toBeCloseTo((400 / 4) * (1 + ROPE_SHARE_ERROR), 4);
  });

  it("wants a wheel a little smaller than a drum would be", () => {
    expect(leastWheel(thin)).toBeLessThan(leastDrum(thin));
    expect(wheelBigEnough(wheel, thin)).toBe(true);
    expect(wheelBigEnough(koepe(2, 180, 0.25, 4), rope(52, constructionNamed("6x36")))).toBe(false);
  });

  it("describes itself in a line", () => {
    expect(describeKoepe(wheel)).toContain("wrap");
  });
});
