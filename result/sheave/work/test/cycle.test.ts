/**
 * The wind, and the standing time that beats it.
 *
 * The property worth testing is the awkward one: in a shallow shaft the
 * cage never reaches full speed, so raising the winder's top speed buys
 * exactly nothing — while a second off the standing time buys a great
 * deal. It is the opposite of where a colliery's money usually goes.
 */

import { describe, expect, it } from "vitest";
import {
  MEN_ACCELERATION,
  MEN_SPEED,
  accelerating,
  atFullShare,
  cycleTime,
  decelerating,
  describeWind,
  forMen,
  menAnHour,
  movingShare,
  needsToReachFull,
  profile,
  reachesFull,
  shiftDown,
  speedFor,
  tonnesADay,
  tonnesAnHour,
  topSpeed,
  windTime,
  windsAnHour,
  worthOfASecond,
  worthOfSpeed,
} from "../src/cycle/kinematics.ts";
import { WindingError } from "../src/errors.ts";

const one = profile();

describe("the shape of a wind", () => {
  it("reaches full speed in a deep shaft and not in a shallow one", () => {
    expect(reachesFull(one, 942)).toBe(true);
    expect(reachesFull(one, 200)).toBe(false);
    expect(needsToReachFull(one)).toBeGreaterThan(200);
  });

  it("peaks below full speed when the shaft is too short", () => {
    expect(topSpeed(one, 200)).toBeLessThan(one.full);
    expect(topSpeed(one, 942)).toBe(one.full);
  });

  it("fits its own profile at every depth, triangular or not", () => {
    for (const each of [60, 120, 200, 226, 300, 600, 942, 2000]) {
      expect(() => windTime(one, each), `${each}`).not.toThrow();
      expect(windTime(one, each), `${each}`).toBeGreaterThan(0);
    }
  });

  it("takes longer for a deeper shaft", () => {
    expect(windTime(one, 1500)).toBeGreaterThan(windTime(one, 942));
    expect(cycleTime(one, 942)).toBe(windTime(one, 942) + one.rest);
  });

  it("spends more of a deep wind at full speed", () => {
    expect(atFullShare(one, 1500)).toBeGreaterThan(atFullShare(one, 600));
    expect(atFullShare(one, 200)).toBe(0);
  });

  it("spends more of a deep cycle moving", () => {
    expect(movingShare(one, 1500)).toBeGreaterThan(movingShare(one, 300));
    expect(movingShare(one, 942)).toBeLessThan(1);
  });

  it("takes as long to stop as to start, near enough", () => {
    expect(accelerating(one)).toBeGreaterThan(decelerating(one));
    expect(describeWind(one, 942)).toContain("winds an hour");
  });

  it("refuses a wind that is all creep", () => {
    expect(() => windTime(one, 8)).toThrow(WindingError);
  });
});

describe("what a winder actually raises", () => {
  it("raises more from a shallow shaft than a deep one", () => {
    expect(tonnesAnHour(one, 300, 12_000)).toBeGreaterThan(tonnesAnHour(one, 942, 12_000));
  });

  it("scales with the payload and the hours", () => {
    expect(tonnesAnHour(one, 942, 24_000)).toBeCloseTo(2 * tonnesAnHour(one, 942, 12_000), 3);
    expect(tonnesADay(one, 942, 12_000, 16)).toBeCloseTo(2 * tonnesADay(one, 942, 12_000, 8), 1);
  });

  it("finds the speed a wanted output asks for", () => {
    const found = speedFor(one, 942, 300, 12_000);
    expect(tonnesAnHour(profile({ ...one, full: found }), 942, 12_000)).toBeGreaterThanOrEqual(300);
  });

  it("refuses an output no allowed speed reaches", () => {
    expect(() => speedFor(one, 942, 900, 12_000)).toThrow(/larger conveyance/);
  });
});

describe("where the money is", () => {
  it("makes speed worth nothing at all in a shallow shaft", () => {
    expect(worthOfSpeed(one, 200, 12_000)).toBe(0);
    expect(worthOfASecond(one, 200, 12_000)).toBeGreaterThan(0);
  });

  it("makes speed worth more than a second in a deep one", () => {
    expect(worthOfSpeed(one, 942, 12_000)).toBeGreaterThan(worthOfASecond(one, 942, 12_000));
  });

  it("puts the crossing point somewhere in between", () => {
    let crossed = 0;
    for (let at = 150; at <= 1200; at += 25) {
      if (worthOfSpeed(one, at, 12_000) > worthOfASecond(one, at, 12_000)) {
        crossed = at;
        break;
      }
    }
    expect(crossed).toBeGreaterThan(150);
    expect(crossed).toBeLessThan(1200);
  });
});

describe("winding men", () => {
  it("is slower in every way", () => {
    const men = forMen(one);
    expect(men.full).toBeLessThanOrEqual(MEN_SPEED);
    expect(men.accelerate).toBeLessThanOrEqual(MEN_ACCELERATION);
    expect(men.rest).toBeGreaterThan(one.rest);
    expect(cycleTime(men, 942)).toBeGreaterThan(cycleTime(one, 942));
  });

  it("moves a shift in something under an hour", () => {
    expect(menAnHour(one, 942, 39)).toBeGreaterThan(300);
    expect(shiftDown(one, 942, 39, 400)).toBeLessThan(60);
    expect(shiftDown(one, 942, 39, 400)).toBeGreaterThan(5);
  });

  it("takes longer for a bigger shift and a smaller cage", () => {
    expect(shiftDown(one, 942, 39, 800)).toBeGreaterThan(shiftDown(one, 942, 39, 400));
    expect(shiftDown(one, 942, 20, 400)).toBeGreaterThan(shiftDown(one, 942, 39, 400));
  });
});

describe("what the profile refuses", () => {
  it("will not creep faster than it winds", () => {
    expect(() => profile({ full: 5, creep: 8 })).toThrow(WindingError);
  });

  it("will not accelerate harder than anything does", () => {
    expect(() => profile({ accelerate: 6 })).toThrow(WindingError);
  });

  it("will not wind faster than anything has", () => {
    expect(() => profile({ full: 40 })).toThrow(WindingError);
  });
});
