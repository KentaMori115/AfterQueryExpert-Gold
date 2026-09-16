/**
 * Sizing, and the figures an installation is signed off against.
 *
 * The property worth testing about the sizing is that it is a cascade
 * and not a loop: every arrow points forward, and the feedback everyone
 * expects lives one level down inside the search for a rope diameter.
 * The property worth testing about the checks is that they rank.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  conveyanceFor,
  cycleOf,
  deepestFor,
  describeSized,
  drumFor,
  drumHolds,
  factorDemanded,
  factorGiven,
  headgearFor,
  payloadFor,
  raises,
  ropeFor,
  ropeTonnes,
  shaftFor,
  shaftWidthFor,
  sizeFor,
  sumpFor,
  tareShare,
  turnsOnIt,
} from "../src/design/sizing.ts";
import { bands, checks, describeCheck, designLoad, failed, meetsDesign, ratings, room, tightest } from "../src/design/checks.ts";
import { parseWinder } from "../src/winder/parse.ts";
import { profile, tonnesAnHour } from "../src/cycle/index.ts";
import { bigEnoughFor, liesDown } from "../src/drum/cylindrical.ts";
import { willFit } from "../src/shaft/index.ts";
import { WindingError } from "../src/errors.ts";

const how = profile();
const bolsover = parseWinder(readFileSync("examples/bolsover.winder", "utf8"));
const whealJane = parseWinder(readFileSync("examples/wheal-jane.winder", "utf8"));

describe("sizing for a duty", () => {
  const one = sizeFor(350, 942, "skip", how);

  it("raises what it was asked for", () => {
    expect(raises(one)).toBeGreaterThanOrEqual(350);
    expect(raises(one)).toBeLessThan(360);
    expect(tonnesAnHour(how, 942, one.conveyance.payload)).toBeCloseTo(raises(one), 3);
  });

  it("builds every part to fit the one before it", () => {
    expect(bigEnoughFor(one.drum, one.rope)).toBe(true);
    expect(liesDown(one.drum)).toBe(true);
    expect(drumHolds(one)).toBe(true);
    expect(willFit(one.shaft, one.conveyance.width)).toBe(true);
  });

  it("gives a rope strong enough for the depth it was sized at", () => {
    expect(factorGiven(one)).toBeGreaterThanOrEqual(factorDemanded(one));
  });

  it("is a cascade, so the same input gives the same answer every time", () => {
    const again = sizeFor(350, 942, "skip", how);
    expect(again.rope.diameter).toBe(one.rope.diameter);
    expect(again.conveyance.payload).toBe(one.conveyance.payload);
    expect(again.shaft.diameter).toBe(one.shaft.diameter);
  });

  it("wants a bigger rope and a bigger shaft in cages than in skips", () => {
    const asCage = sizeFor(350, 942, "cage", how);
    expect(asCage.rope.diameter).toBeGreaterThan(one.rope.diameter);
    expect(asCage.shaft.diameter).toBeGreaterThan(one.shaft.diameter);
    expect(ropeTonnes(asCage)).toBeGreaterThan(ropeTonnes(one));
  });

  it("reaches deeper in skips than in cages", () => {
    expect(deepestFor(350, "skip", how)).toBeGreaterThan(deepestFor(350, "cage", how));
  });

  it("takes the payload from the cycle and nothing else", () => {
    expect(payloadFor(350, 942, how)).toBeCloseTo((350 * 1000) / (3600 / cycleOf(one)), -1);
  });

  it("gives a cage twice the tare of its payload and a skip two fifths", () => {
    expect(tareShare("cage")).toBeGreaterThan(1);
    expect(tareShare("skip")).toBeLessThan(1);
    expect(conveyanceFor(12_000, "cage").tare).toBeGreaterThan(conveyanceFor(12_000, "skip").tare);
  });

  it("sizes the sump and the headgear from the speed", () => {
    expect(sumpFor(20)).toBeGreaterThan(sumpFor(10));
    expect(headgearFor(20)).toBeGreaterThan(headgearFor(10));
    expect(one.shaft.sump).toBeGreaterThan(0);
  });

  it("refuses a duty no rope will do", () => {
    expect(() => sizeFor(2000, 2500, "cage", how)).toThrow(WindingError);
  });

  it("builds the parts separately as well as together", () => {
    const conveyance = conveyanceFor(12_000, "skip");
    const line = ropeFor(conveyance, 942);
    expect(bigEnoughFor(drumFor(line, 984), line)).toBe(true);
    expect(willFit(shaftFor(conveyance, 942), conveyance.width)).toBe(true);
    expect(shaftWidthFor(2.2)).toBeGreaterThan(4.4);
    expect(turnsOnIt(one)).toBeGreaterThan(10);
    expect(describeSized(one)).toContain("shaft");
  });
});

describe("the checks", () => {
  it("passes an installation with nothing the matter with it", () => {
    expect(meetsDesign(bolsover)).toBe(true);
    expect(failed(checks(bolsover))).toHaveLength(0);
  });

  it("misses several on one nobody has spent money on", () => {
    expect(meetsDesign(whealJane)).toBe(false);
    expect(failed(checks(whealJane)).length).toBeGreaterThan(3);
  });

  it("reports every band whether it passes or not", () => {
    expect(checks(bolsover).length).toBe(checks(whealJane).length);
    expect(checks(bolsover).length).toBeGreaterThan(15);
  });

  it("gives a missed check no room at all", () => {
    for (const each of failed(checks(whealJane))) expect(room(each), each.name).toBe(0);
  });

  it("keeps every room between nought and one", () => {
    for (const one of [bolsover, whealJane]) {
      for (const each of checks(one)) {
        expect(room(each), each.name).toBeGreaterThanOrEqual(0);
        expect(room(each), each.name).toBeLessThanOrEqual(3);
      }
    }
  });

  it("names the check with the least room in it", () => {
    const least = tightest(bolsover);
    for (const each of checks(bolsover)) expect(room(each)).toBeGreaterThanOrEqual(room(least));
  });

  it("lets a caller move a band without moving the rest", () => {
    const strict = bands({ dead: 0.4 });
    expect(strict.dead).toBe(0.4);
    expect(strict.ratio).toBe(bands().ratio);
    expect(failed(checks(bolsover, strict)).length).toBeGreaterThan(0);
  });

  it("writes a check out and gives the ratings beside it", () => {
    expect(describeCheck(checks(bolsover)[0] as never)).toContain("factor");
    expect(ratings(bolsover).motor).toBeGreaterThan(0);
    expect(ratings(bolsover).peak).toBeGreaterThan(ratings(bolsover).motor);
    expect(designLoad(bolsover)).toBeGreaterThan(0);
  });
});
