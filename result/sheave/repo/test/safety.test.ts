/**
 * The gear that does not trust the engineman.
 *
 * A single trip speed catches a winder running away in mid-shaft and
 * does nothing at all about one arriving at the landing at full speed,
 * because full speed is not an overspeed. So the gear carries a curve
 * instead, and the curve is what these tests are about.
 */

import { describe, expect, it } from "vitest";
import {
  ARRESTOR,
  EMERGENCY_BRAKE,
  EXAMINED_EVERY,
  OVERSPEED_MARGIN,
  RECAPPED_EVERY,
  WORKING_BRAKE,
  curveBegins,
  curveSpeed,
  describeGear,
  hookBand,
  hookHolds,
  hookLoad,
  hookPartsFirst,
  insideCurve,
  inspected,
  keps,
  kepsHold,
  kepsShare,
  retardationFor,
  stoppingDistance,
  stoppingTime,
  tripSpeed,
} from "../src/safety/gear.ts";
import {
  CAPPINGS,
  CUT_OFF,
  RECAP_MONTHS,
  busyLength,
  busyShare,
  cappingHours,
  cappingNamed,
  capped,
  describeCapping,
  goodForWinding,
  heldBy,
  keeps,
  orderExtra,
  orderLength,
  recappings,
  servesFor,
  shiftFor,
  whiteMetal,
} from "../src/rope/capping.ts";
import { breakingLoad, rope } from "../src/rope/index.ts";
import { profile } from "../src/cycle/index.ts";
import { WindingError } from "../src/errors.ts";

const one = profile();
const line = rope(52);

describe("stopping", () => {
  it("counts the distance covered while the brake makes up its mind", () => {
    expect(stoppingDistance(15, EMERGENCY_BRAKE, 0.5)).toBeGreaterThan((15 * 15) / (2 * EMERGENCY_BRAKE));
    expect(stoppingDistance(15, EMERGENCY_BRAKE, 0)).toBeCloseTo((15 * 15) / (2 * EMERGENCY_BRAKE), 3);
  });

  it("goes as the square of the speed", () => {
    expect(stoppingDistance(20, EMERGENCY_BRAKE, 0) / stoppingDistance(10, EMERGENCY_BRAKE, 0)).toBeCloseTo(4, 2);
    expect(stoppingTime(15)).toBeGreaterThan(15 / EMERGENCY_BRAKE);
  });

  it("orders the three retardations the way the machinery does", () => {
    expect(WORKING_BRAKE).toBeLessThan(EMERGENCY_BRAKE);
    expect(EMERGENCY_BRAKE).toBeLessThan(ARRESTOR);
  });

  it("says what retardation a stated room asks for", () => {
    const wanted = retardationFor(15, 32);
    expect(stoppingDistance(15, wanted, 0.5)).toBeCloseTo(32, 1);
  });

  it("refuses a room the wind covers before the brake applies", () => {
    expect(() => retardationFor(15, 5)).toThrow(WindingError);
  });
});

describe("the overspeed gear", () => {
  it("trips a little above full speed and not on it", () => {
    expect(tripSpeed(one)).toBeGreaterThan(one.full);
    expect(tripSpeed(one)).toBeCloseTo(one.full * OVERSPEED_MARGIN, 3);
    expect(() => tripSpeed(one, 1)).toThrow(WindingError);
  });

  it("carries a curve that falls to nothing at the landing", () => {
    expect(curveSpeed(0)).toBe(0);
    expect(curveSpeed(50)).toBeGreaterThan(curveSpeed(20));
  });

  it("lets full speed through only outside the curve's own reach", () => {
    const begins = curveBegins(one);
    expect(insideCurve(begins + 5, one.full)).toBe(true);
    expect(insideCurve(begins - 5, one.full)).toBe(false);
  });

  it("agrees with the stopping distance it was derived from", () => {
    const at = curveSpeed(40);
    expect(stoppingDistance(at)).toBeCloseTo(40, 1);
  });
});

describe("the detaching hook", () => {
  const working = 260;
  const band = hookBand(breakingLoad(line), working);

  it("sits above the working load and below the rope", () => {
    expect(band.low).toBeGreaterThan(working);
    expect(band.high).toBeCloseTo(breakingLoad(line), 3);
    expect(band.low).toBeLessThan(band.high);
  });

  it("holds the wind and parts before the rope", () => {
    const at = hookLoad(breakingLoad(line));
    expect(hookHolds(at, working)).toBe(true);
    expect(hookPartsFirst(breakingLoad(line), at)).toBe(true);
  });

  it("has no band at all when the rope's factor has been eaten", () => {
    expect(() => hookBand(400, 260)).toThrow(WindingError);
  });
});

describe("the keps and the examinations", () => {
  it("hold the conveyance and take part of the standing time", () => {
    const catches = keps(400, 3);
    expect(kepsHold(catches, 260)).toBe(true);
    expect(kepsHold(catches, 500)).toBe(false);
    expect(kepsShare(catches, 25)).toBeCloseTo(6 / 25, 3);
  });

  it("meet the rules when kept to them", () => {
    expect(inspected(EXAMINED_EVERY, RECAPPED_EVERY)).toBe(true);
    expect(inspected(3, RECAPPED_EVERY)).toBe(false);
    expect(inspected(EXAMINED_EVERY, 12)).toBe(false);
  });

  it("describes the arrangements in a line", () => {
    expect(describeGear(one, 32, breakingLoad(line), 260)).toContain("hook");
  });
});

describe("the capel and its calendar", () => {
  it("keeps the whole strength only in white metal", () => {
    expect(keeps("white metal")).toBe(1);
    expect(goodForWinding("white metal")).toBe(true);
    for (const each of Object.keys(CAPPINGS) as (keyof typeof CAPPINGS)[]) {
      if (each === "white metal") continue;
      expect(goodForWinding(each), each).toBe(false);
      expect(heldBy(line, each), each).toBeLessThan(breakingLoad(line));
    }
  });

  it("orders a rope longer than the shaft for the cuts to come", () => {
    const wanted = orderLength(942, 42, 40, 24);
    expect(wanted).toBeGreaterThan(942 + 42 + 40);
    expect(orderExtra(24)).toBeCloseTo(recappings(24) * CUT_OFF, 3);
  });

  it("puts a calendar on a sound rope", () => {
    const have = orderLength(942, 42, 40, 24);
    expect(servesFor(have, 942 + 42 + 40)).toBeGreaterThanOrEqual(24);
    expect(() => servesFor(500, 1024)).toThrow(WindingError);
  });

  it("makes the busy end a small share of the whole", () => {
    expect(busyLength(42, 40)).toBe(82);
    expect(busyShare(42, 40, 1024)).toBeLessThan(0.2);
    expect(shiftFor(42, 40, 8)).toBeCloseTo(82 / 8, 2);
  });

  it("wants metal and hours to make", () => {
    expect(whiteMetal(line)).toBeGreaterThan(0);
    expect(cappingHours(line)).toBeGreaterThan(3);
    expect(capped(RECAP_MONTHS)).toBe(true);
    expect(capped(12)).toBe(false);
    expect(describeCapping(line, "white metal")).toContain("capel");
  });

  it("refuses a capping it has never heard of", () => {
    expect(() => cappingNamed("knot")).toThrow(/white metal/);
  });
});
