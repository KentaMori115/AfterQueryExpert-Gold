/**
 * The two example installations, taken as fixtures.
 *
 * A library of this kind is only as good as the two or three worked
 * examples somebody can check it against, and these are the ones the
 * documentation is written round. If a change moves a figure on either
 * of these certificates it has moved a figure somebody has read, and
 * this file is where that is noticed.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parseWinder } from "../src/winder/parse.ts";
import { auditWinder, counted } from "../src/winder/audit.ts";
import { checks, failed, meetsDesign } from "../src/design/checks.ts";
import {
  balanceSwing,
  cycleLasts,
  deadShare,
  drumOf,
  energyATonne,
  factor,
  factorWanted,
  motor,
  outputPerDay,
  peak,
  ropeStrongEnough,
  windLength,
  worstShare,
} from "../src/winder/model.ts";
import { bigEnoughFor, fleetAngle, liesDown } from "../src/drum/cylindrical.ts";
import { lifeIn } from "../src/rope/index.ts";
import { usefulFraction } from "../src/cage/index.ts";
import { perTonne, prices } from "../src/costing/works.ts";

const bolsover = parseWinder(readFileSync("examples/bolsover.winder", "utf8"));
const whealJane = parseWinder(readFileSync("examples/wheal-jane.winder", "utf8"));

describe("Bolsover No.2, a deep shaft doing what a deep shaft is for", () => {
  it("is a skip winder on a balance rope", () => {
    expect(bolsover.rising.kind).toBe("skip");
    expect(bolsover.balance).toBeGreaterThan(9);
    expect(balanceSwing(bolsover)).toBeLessThan(1);
  });

  it("winds nine hundred metres in a hundred seconds", () => {
    expect(windLength(bolsover)).toBe(942);
    expect(cycleLasts(bolsover)).toBeGreaterThan(100);
    expect(cycleLasts(bolsover)).toBeLessThan(150);
  });

  it("raises five thousand tonnes a day", () => {
    expect(outputPerDay(bolsover)).toBeGreaterThan(4500);
    expect(outputPerDay(bolsover)).toBeLessThan(6500);
  });

  it("keeps its rope inside the rule with room to spare", () => {
    expect(ropeStrongEnough(bolsover)).toBe(true);
    expect(factor(bolsover) - factorWanted(bolsover)).toBeGreaterThan(0.5);
  });

  it("has a drum large enough and a lead long enough", () => {
    expect(bigEnoughFor(drumOf(bolsover), bolsover.rope)).toBe(true);
    expect(liesDown(drumOf(bolsover))).toBe(true);
    expect(fleetAngle(drumOf(bolsover))).toBeLessThan(1.5);
  });

  it("gets a full life out of its rope", () => {
    expect(lifeIn(bolsover.rope, drumOf(bolsover).diameter)).toBeGreaterThan(300_000);
  });

  it("spends most of its lifting on coal rather than steel", () => {
    expect(usefulFraction(bolsover.rising)).toBeGreaterThan(0.65);
    expect(deadShare(bolsover)).toBeLessThan(0.6);
  });

  it("passes every check and every audit", () => {
    expect(meetsDesign(bolsover)).toBe(true);
    expect(counted(auditWinder(bolsover)).error).toBe(0);
  });

  it("costs well under a pound a tonne to wind", () => {
    expect(perTonne(bolsover, prices())).toBeLessThan(100);
  });
});

describe("Wheal Jane No.1, the year before it was abandoned", () => {
  it("is a cage winder with no balance rope", () => {
    expect(whealJane.rising.kind).toBe("cage");
    expect(whealJane.balance).toBe(0);
    expect(balanceSwing(whealJane)).toBeGreaterThan(10);
  });

  it("has a rope inside the rule and nothing else in order", () => {
    expect(ropeStrongEnough(whealJane)).toBe(true);
    expect(meetsDesign(whealJane)).toBe(false);
    expect(failed(checks(whealJane)).length).toBeGreaterThan(3);
  });

  it("bends a stiff rope round a drum far too small for it", () => {
    expect(bigEnoughFor(drumOf(whealJane), whealJane.rope)).toBe(false);
    expect(whealJane.rope.construction.name).toContain("6x7");
    expect(lifeIn(whealJane.rope, drumOf(whealJane).diameter)).toBeLessThan(300_000);
  });

  it("has a fleet angle nothing will lie down at", () => {
    expect(liesDown(drumOf(whealJane))).toBe(false);
  });

  it("lifts two thirds steel", () => {
    expect(deadShare(whealJane)).toBeGreaterThan(0.6);
    expect(usefulFraction(whealJane.rising)).toBeLessThan(0.5);
  });

  it("raises a fifth of what the other does and costs three times as much", () => {
    expect(outputPerDay(whealJane)).toBeLessThan(outputPerDay(bolsover) / 3);
    expect(perTonne(whealJane, prices())).toBeGreaterThan(perTonne(bolsover, prices()));
  });

  it("raises several errors and passes none of them off as warnings", () => {
    expect(counted(auditWinder(whealJane)).error).toBeGreaterThan(2);
  });
});

describe("the two of them together", () => {
  it("show what the skip did for a deep shaft", () => {
    expect(usefulFraction(bolsover.rising)).toBeGreaterThan(usefulFraction(whealJane.rising));
    expect(energyATonne(bolsover)).toBeGreaterThan(energyATonne(whealJane));
    expect(motor(bolsover)).toBeGreaterThan(motor(whealJane));
    expect(peak(bolsover)).toBeGreaterThan(peak(whealJane));
  });

  it("are read from files anybody can open and change", () => {
    for (const each of ["examples/bolsover.winder", "examples/wheal-jane.winder"]) {
      const text = readFileSync(each, "utf8");
      expect(text).toContain("#");
      expect(text.split("\n").length).toBeGreaterThan(10);
      expect(() => parseWinder(text)).not.toThrow();
    }
  });
});

describe("Zollverein 12, a friction winder on four ropes", () => {
  const zollverein = parseWinder(readFileSync("examples/zollverein.winder", "utf8"));

  it("drives by friction and has no drum to ask about", () => {
    expect(zollverein.drive.kind).toBe("koepe");
    expect(() => drumOf(zollverein)).toThrow();
    expect(zollverein.ropes).toBe(4);
  });

  it("judges the rope on the worst of the set and not the mean", () => {
    // A quarter of the load and a tenth again, because four ropes over
    // one wheel are never exactly the same length.
    expect(worstShare(4)).toBeCloseTo(1.1 / 4, 5);
    expect(worstShare(1)).toBe(1);
    expect(ropeStrongEnough(zollverein)).toBe(true);
  });

  it("keeps its tensions inside the capstan equation with a balance rope", () => {
    expect(zollverein.balance).toBeGreaterThan(20);
    expect(counted(auditWinder(zollverein)).error).toBe(0);
  });

  it("hangs half its own load in rope at eleven hundred metres", () => {
    expect(deadShare(zollverein)).toBeGreaterThan(0.6);
    expect(windLength(zollverein)).toBe(1100);
  });

  it("raises twice what the drum winder does, on twice the motor", () => {
    expect(outputPerDay(zollverein)).toBeGreaterThan(outputPerDay(bolsover));
    expect(motor(zollverein)).toBeGreaterThan(motor(bolsover));
  });
});
