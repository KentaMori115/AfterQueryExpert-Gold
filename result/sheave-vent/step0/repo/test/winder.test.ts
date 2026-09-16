/**
 * A whole installation, and the file that describes one.
 *
 * The two examples are the fixtures. Bolsover is a deep shaft doing
 * what a deep shaft is for; Wheal Jane is the year before it was
 * abandoned. An audit that cannot tell those two apart is not an audit.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { KEYWORDS, parseWinder, readShare } from "../src/winder/parse.ts";
import {
  balanceSwing,
  cycleLasts,
  deadShare,
  describeWinder,
  drumOf,
  dutyOf,
  energyADay,
  energyATonne,
  factor,
  factorWanted,
  hangingLoad,
  inertiaOf,
  motor,
  outputPerDay,
  outputPerHour,
  outputPerYear,
  peak,
  rms,
  ropeMargin,
  ropeStrongEnough,
  ropeWanted,
  wheelOf,
  windLasts,
  windLength,
  windsPerHour,
  winder,
} from "../src/winder/model.ts";
import {
  auditWinder,
  counted,
  conveyanceFindings,
  cycleFindings,
  driveFindings,
  engineFindings,
  errors,
  passes,
  ropeFindings,
  safetyFindings,
  shaftFindings,
  summary,
} from "../src/winder/audit.ts";
import { WindingError } from "../src/errors.ts";

const bolsover = parseWinder(readFileSync("examples/bolsover.winder", "utf8"));
const whealJane = parseWinder(readFileSync("examples/wheal-jane.winder", "utf8"));

describe("reading a winder file", () => {
  it("reads both of the examples", () => {
    expect(bolsover.name).toBe("Bolsover No.2");
    expect(whealJane.name).toBe("Wheal Jane No.1");
    expect(bolsover.rope.diameter).toBe(52);
    expect(bolsover.balance).toBeGreaterThan(9);
  });

  it("knows a fixed set of keywords and no others", () => {
    expect(KEYWORDS).toContain("koepe");
    expect(() => parseWinder("winderr X")).toThrow(/winderr/);
  });

  it("refuses a key the keyword does not take", () => {
    expect(() => parseWinder("winder X\nrope dimeter=52mm")).toThrow(/dimeter/);
  });

  it("says which line the mistake is on", () => {
    expect(() => parseWinder("# a note\nwinder X\nrope grade=nine")).toThrow(/line 3/);
  });

  it("refuses a quantity without a unit where one is wanted", () => {
    expect(() => parseWinder("winder X\nshaft Y diameter=7 depth=942m")).toThrow(WindingError);
  });

  it("refuses a file that names two winders or two drives", () => {
    expect(() => parseWinder("winder A\nwinder B")).toThrow(/two winders/);
    expect(() =>
      parseWinder("winder A\ndrum diameter=4m width=2m\nkoepe diameter=5m"),
    ).toThrow(/two drives/);
  });

  it("refuses a file with nothing going up or nothing driving it", () => {
    expect(() => parseWinder("winder A")).toThrow(/no shaft/);
  });

  it("rounds the rope diameter back to whole millimetres", () => {
    expect(Number.isInteger(bolsover.rope.diameter)).toBe(true);
  });

  it("reads a share the way the file writes one", () => {
    expect(readShare("40")).toBe(40);
    expect(readShare("40%")).toBe(40);
  });
});

describe("Bolsover No.2, doing what a deep shaft is for", () => {
  it("winds a large payload with a small tare", () => {
    expect(bolsover.rising.kind).toBe("skip");
    expect(deadShare(bolsover)).toBeLessThan(0.65);
  });

  it("is balanced against its own rope", () => {
    expect(balanceSwing(bolsover)).toBeLessThan(1);
  });

  it("has a rope strong enough for its depth", () => {
    expect(ropeStrongEnough(bolsover)).toBe(true);
    expect(factor(bolsover)).toBeGreaterThan(factorWanted(bolsover));
    expect(ropeMargin(bolsover)).toBeGreaterThan(0.5);
  });

  it("raises thousands of tonnes a day on a megawatt or two", () => {
    expect(outputPerDay(bolsover)).toBeGreaterThan(4000);
    expect(motor(bolsover)).toBeGreaterThan(1000);
    expect(motor(bolsover)).toBeLessThan(3000);
    expect(peak(bolsover)).toBeGreaterThan(rms(bolsover));
  });

  it("passes its own audit", () => {
    expect(passes(bolsover)).toBe(true);
    expect(errors(auditWinder(bolsover))).toHaveLength(0);
  });
});

describe("Wheal Jane No.1, the year before it was abandoned", () => {
  it("does not pass", () => {
    expect(passes(whealJane)).toBe(false);
    expect(errors(auditWinder(whealJane)).length).toBeGreaterThan(2);
  });

  it("has a drum too small for its rope", () => {
    const said = driveFindings(whealJane).map((each) => each.message).join(" ");
    expect(said).toMatch(/to one where 80/);
  });

  it("has a fleet angle nothing will lie down at", () => {
    expect(driveFindings(whealJane).map((each) => each.message).join(" ")).toContain("fleet angle");
  });

  it("has conveyances that will not go down the shaft", () => {
    expect(shaftFindings(whealJane).map((each) => each.message).join(" ")).toContain("will not go down");
  });

  it("has a sump too shallow for its speed", () => {
    expect(shaftFindings(whealJane).map((each) => each.message).join(" ")).toContain("underwind");
  });

  it("has a pair of conveyances that are not matched", () => {
    expect(conveyanceFindings(whealJane).map((each) => each.message).join(" ")).toContain("out-of-balance");
  });

  it("shows an out-of-balance swing with no balance rope", () => {
    expect(balanceSwing(whealJane)).toBeGreaterThan(10);
    expect(engineFindings(whealJane).map((each) => each.message).join(" ")).toContain("balance rope");
  });
});

describe("the audit as a whole", () => {
  it("orders the findings the way the load travels", () => {
    const found = auditWinder(bolsover).map((each) => each.part);
    expect(found.indexOf("rope")).toBeLessThan(found.indexOf("drum"));
    expect(found.indexOf("drum")).toBeLessThan(found.indexOf("conveyance"));
    expect(found.indexOf("conveyance")).toBeLessThan(found.indexOf("shaft"));
    expect(found.indexOf("shaft")).toBeLessThan(found.indexOf("cycle"));
    expect(found.indexOf("cycle")).toBeLessThan(found.indexOf("engine"));
    expect(found.indexOf("engine")).toBeLessThan(found.indexOf("safety"));
  });

  it("is the sum of its parts and nothing else", () => {
    const parts = [
      ...ropeFindings(bolsover),
      ...driveFindings(bolsover),
      ...conveyanceFindings(bolsover),
      ...shaftFindings(bolsover),
      ...cycleFindings(bolsover),
      ...engineFindings(bolsover),
      ...safetyFindings(bolsover),
    ];
    expect(parts).toHaveLength(auditWinder(bolsover).length);
  });

  it("counts every finding under one severity", () => {
    for (const one of [bolsover, whealJane]) {
      const found = auditWinder(one);
      const how = counted(found);
      expect(how.note + how.warning + how.error).toBe(found.length);
    }
  });

  it("never throws while describing an installation that cannot work", () => {
    expect(() => auditWinder(whealJane)).not.toThrow();
    expect(summary(whealJane)).toContain("t/d");
  });
});

describe("the model's own arithmetic", () => {
  it("wants the depth and the headgear in rope", () => {
    expect(ropeWanted(bolsover)).toBe(windLength(bolsover) + bolsover.shaft.headgear);
  });

  it("counts the rotating parts", () => {
    expect(inertiaOf(bolsover)).toBeGreaterThan(10_000);
    expect(dutyOf(bolsover).inertia).toBe(inertiaOf(bolsover));
  });

  it("scales the output through the hours and the days", () => {
    expect(outputPerDay(bolsover)).toBeCloseTo(outputPerHour(bolsover) * bolsover.hours, 0);
    expect(outputPerYear(bolsover, 300)).toBeCloseTo(outputPerDay(bolsover) * 300, -1);
    expect(energyADay(bolsover)).toBeCloseTo(energyATonne(bolsover) * outputPerDay(bolsover), 0);
  });

  it("agrees with itself about the cycle", () => {
    expect(cycleLasts(bolsover)).toBeGreaterThan(windLasts(bolsover));
    expect(windsPerHour(bolsover)).toBeCloseTo(3600 / cycleLasts(bolsover), 3);
    expect(hangingLoad(bolsover)).toBeGreaterThan(0);
    expect(describeWinder(bolsover)).toContain("motor");
  });

  it("refuses to ask a drum winder for its wheel, or the other way", () => {
    expect(() => wheelOf(bolsover)).toThrow(WindingError);
    expect(drumOf(bolsover).diameter).toBeGreaterThan(4);
  });

  it("refuses a winder with no name", () => {
    expect(() => winder({ ...bolsover, name: "  " })).toThrow(WindingError);
  });
});
