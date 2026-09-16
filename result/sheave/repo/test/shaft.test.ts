/**
 * The shaft and its guides.
 *
 * A winding shaft is also a ventilation shaft at most collieries, and
 * the two duties are in direct competition: every square metre of
 * conveyance is a square metre the air has to go round. And a
 * conveyance hanging on a kilometre of rope is a pendulum, so something
 * has to hold it — with the span of a taut string's stiffness being the
 * conveyance's own shoes and not the depth of the shaft, which is the
 * error this module exists to have got right.
 */

import { describe, expect, it } from "vitest";
import {
  BETWEEN_CONVEYANCES,
  BRISK_AIR,
  TO_GUIDES,
  TO_LINING,
  airSpeed,
  area,
  comfortable,
  deepest,
  describeShaft,
  excavated,
  freeArea,
  freeShare,
  insets,
  liningVolume,
  overwindRoom,
  ropeLength,
  shaft,
  stoppableFrom,
  sumpEnough,
  sumpFor,
  widestConveyance,
  widthWanted,
  willFit,
} from "../src/shaft/shaft.ts";
import {
  GUIDE_FACTOR,
  MOST_SWAY,
  OUT_OF_SQUARE,
  SHOE_SPAN,
  buntonDrag,
  buntons,
  describeGuides,
  guideFactor,
  guideStrongEnough,
  guides,
  lateralLoad,
  ropeStiffness,
  staysClear,
  stiffnessRange,
  sway,
  swingPeriod,
  tensionAt,
  tensionFor,
} from "../src/shaft/guides.ts";
import { constructionNamed, rope } from "../src/rope/index.ts";
import { WindingError } from "../src/errors.ts";

const one = shaft("No.2 Downcast", 7.3, 942, 2, 15, 42);

describe("the shaft", () => {
  it("has the area a circle of that diameter has", () => {
    expect(area(one)).toBeCloseTo((Math.PI * 7.3 * 7.3) / 4, 3);
  });

  it("pays out the depth and the headgear together", () => {
    expect(ropeLength(one)).toBeCloseTo(942 + 42, 3);
  });

  it("takes two conveyances with the clearances the rules want", () => {
    expect(willFit(one, 2.6)).toBe(true);
    expect(willFit(one, 3.2)).toBe(false);
    expect(widthWanted(2.6)).toBeGreaterThan(2 * 2.6);
  });

  it("says the widest it takes, and that width fits", () => {
    const widest = widestConveyance(one);
    expect(willFit(one, widest)).toBe(true);
    expect(willFit(one, widest + 0.05)).toBe(false);
  });

  it("leaves most of itself for the air, and not all", () => {
    expect(freeShare(one, 2.6)).toBeGreaterThan(0.6);
    expect(freeShare(one, 2.6)).toBeLessThan(0.95);
    expect(freeArea(one, 2.6)).toBeLessThan(area(one));
  });

  it("makes the air brisk if there is too much of it", () => {
    expect(comfortable(one, 180, 2.6)).toBe(true);
    expect(comfortable(one, 600, 2.6)).toBe(false);
    expect(airSpeed(one, 600, 2.6)).toBeGreaterThan(BRISK_AIR);
  });

  it("refuses a shaft with nothing left in it for the air", () => {
    expect(() => freeArea(shaft("tiny", 2.5, 100), 2.4, 2.4)).toThrow(WindingError);
  });

  it("arrests an overwind in the room above the bank", () => {
    expect(overwindRoom(one)).toBeCloseTo(42 - 6 - 4, 2);
    expect(stoppableFrom(one)).toBeGreaterThan(15);
  });

  it("wants a sump deep enough for the speed being wound at", () => {
    expect(sumpFor(15)).toBeGreaterThan(10);
    expect(sumpEnough(one, 15)).toBe(true);
    expect(sumpEnough(one, 25)).toBe(false);
  });

  it("sorts its insets and takes the deepest", () => {
    expect(insets(one, [900, 420, 680])).toEqual([420, 680, 900]);
    expect(deepest(one, [420, 680, 900])).toBe(900);
    expect(() => insets(one, [1200])).toThrow(WindingError);
  });

  it("knows what it took to sink", () => {
    expect(excavated(one)).toBeGreaterThan(liningVolume(one));
    expect(describeShaft(one)).toContain("headgear");
  });

  it("keeps the clearances the rules ask for", () => {
    expect(BETWEEN_CONVEYANCES).toBeGreaterThan(0);
    expect(TO_LINING).toBeGreaterThan(BETWEEN_CONVEYANCES);
    expect(TO_GUIDES).toBeLessThan(BETWEEN_CONVEYANCES);
  });
});

describe("the guides", () => {
  const ropes = guides("rope", 4, 6, 90);
  const rigid = guides("rigid", 4, 6, 0);
  const lateral = lateralLoad(17_040);

  it("takes a share of the conveyance's weight sideways", () => {
    expect(lateral).toBeCloseTo(17_040 * 9.80665 * OUT_OF_SQUARE / 1000, 3);
  });

  it("gets its stiffness from the tension and not the steel", () => {
    expect(ropeStiffness(guides("rope", 4, 6, 180), SHOE_SPAN)).toBeCloseTo(2 * ropeStiffness(ropes, SHOE_SPAN), 3);
  });

  it("uses the conveyance's shoes as the span and not the shaft", () => {
    // The classic error gives an answer two hundred times too soft.
    expect(sway(ropes, SHOE_SPAN, lateral)).toBeLessThan(0.05);
    expect(sway(ropes, 942, lateral)).toBeGreaterThan(1);
  });

  it("makes a rope guide sway more than a rigid one, and both a little", () => {
    expect(sway(ropes, SHOE_SPAN, lateral)).toBeGreaterThan(sway(rigid, rigid.spacing, lateral));
    expect(staysClear(ropes, SHOE_SPAN, lateral)).toBe(true);
    expect(staysClear(rigid, rigid.spacing, lateral)).toBe(true);
    expect(MOST_SWAY).toBeGreaterThan(0.01);
  });

  it("finds the tension a wanted sway asks for", () => {
    const wanted = tensionFor(SHOE_SPAN, lateral, 4, 0.005);
    expect(sway(guides("rope", 4, 6, wanted), SHOE_SPAN, lateral)).toBeLessThanOrEqual(0.005);
  });

  it("hangs vertically, so its tension rises up the shaft rather than sagging", () => {
    const guideRope = rope(38, constructionNamed("6x19"), 1770);
    expect(tensionAt(guideRope, ropes, 942)).toBeGreaterThan(ropes.tension);
    expect(tensionAt(guideRope, ropes, 0)).toBeCloseTo(ropes.tension, 3);
    expect(stiffnessRange(guideRope, ropes, 942)).toBeGreaterThan(1);
  });

  it("works its guide ropes at a lower factor than a winding rope", () => {
    const guideRope = rope(38, constructionNamed("6x19"), 1770);
    expect(guideStrongEnough(guideRope, 942, 90)).toBe(true);
    expect(guideFactor(guideRope, 942, 90)).toBeGreaterThan(GUIDE_FACTOR);
  });

  it("puts a bunton every few metres and charges the fan for them", () => {
    expect(buntons(rigid, 942)).toBe(Math.ceil(942 / 6));
    expect(buntonDrag(rigid, 942, 7.3)).toBeGreaterThan(0);
    expect(buntons(guides("rigid", 4, 9, 0), 942)).toBeLessThan(buntons(rigid, 942));
  });

  it("refuses to ask a rigid guide about tension, or a rope guide about buntons", () => {
    expect(() => ropeStiffness(rigid, SHOE_SPAN)).toThrow(WindingError);
    expect(() => buntons(ropes, 942)).toThrow(WindingError);
    expect(() => guides("rope", 4, 6, 0)).toThrow(WindingError);
  });

  it("swings very slowly if nothing holds it", () => {
    expect(swingPeriod(942)).toBeGreaterThan(50);
    expect(swingPeriod(100)).toBeLessThan(swingPeriod(942));
    expect(describeGuides(ropes, 942)).toContain("stiffness");
  });
});
