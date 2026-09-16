/**
 * The three certificates that come with the library, read as springs.
 *
 * Bolsover is deep and carries a balance rope; Wheal Jane is shallow and
 * carries none; Zollverein is deep, balanced, and hangs on four ropes.
 * Between them they cover the thing worth knowing about a stopped wind,
 * which is that the worst place in the shaft to be stopped is not the
 * same place on all three.
 *
 * A conveyance rising pays the winding rope onto the drum and pays the
 * balance rope out under itself. What hangs on the rope hardly changes
 * across a wind, which is what a balance rope is for. What has to be
 * retarded changes a great deal, because the whole of the balance rope
 * swings and only a third of the winding rope does.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parseWinder } from "../../src/winder/parse.ts";
import { hangAt, ropeWanted, windLength, worstShock } from "../../src/winder/model.ts";
import { bounceMass, shockFactor, springRate } from "../../src/rope/index.ts";
import { massPerMetre } from "../../src/rope/construction.ts";
import { gross } from "../../src/cage/index.ts";
import { weightOf } from "../../src/units/measure.ts";
import type { Winder } from "../../src/winder/model.ts";
import { EMERGENCY_BRAKE } from "../../src/safety/gear.ts";

const bolsover = parseWinder(readFileSync("examples/bolsover.winder", "utf8"));
const whealJane = parseWinder(readFileSync("examples/wheal-jane.winder", "utf8"));
const zollverein = parseWinder(readFileSync("examples/zollverein.winder", "utf8"));

function hangingAt(one: Winder, up: number): number {
  const there = hangAt(one, up);
  return weightOf(there.carried + there.balance + massPerMetre(one.rope) * one.ropes * there.length);
}

describe("the rope hanging at a point in the wind", () => {
  it("reaches from the sheave and not from the bank", () => {
    expect(hangAt(bolsover, 0).length).toBeCloseTo(ropeWanted(bolsover), 3);
    expect(hangAt(bolsover, 0).length).toBeGreaterThan(windLength(bolsover));
  });

  it("shortens by every metre the conveyance has risen", () => {
    expect(hangAt(bolsover, 400).length).toBeCloseTo(ropeWanted(bolsover) - 400, 3);
  });

  it("leaves the headgear's worth of rope with the conveyance at the bank", () => {
    expect(hangAt(bolsover, windLength(bolsover)).length).toBeCloseTo(bolsover.shaft.headgear, 3);
    expect(hangAt(bolsover, windLength(bolsover)).length).toBeGreaterThan(0);
  });

  it("carries a balance rope as long as the conveyance is high", () => {
    expect(hangAt(bolsover, 0).balance).toBeCloseTo(0, 6);
    expect(hangAt(bolsover, 500).balance).toBeCloseTo(bolsover.balance * 500, 3);
    expect(hangAt(bolsover, windLength(bolsover)).balance).toBeCloseTo(bolsover.balance * windLength(bolsover), 3);
  });

  it("carries none at all where the certificate names none", () => {
    expect(whealJane.balance).toBe(0);
    for (const up of [0, 100, 380]) expect(hangAt(whealJane, up).balance).toBe(0);
  });

  it("carries the rising conveyance loaded", () => {
    expect(hangAt(bolsover, 0).carried).toBeCloseTo(gross(bolsover.rising), 3);
  });

  it("is the two ends of one rope, hard at the bank and soft at the bottom", () => {
    const bottom = hangAt(bolsover, 0);
    const bank = hangAt(bolsover, windLength(bolsover));
    expect(bank.length).toBeLessThan(bottom.length);
    expect(springRate(bank)).toBeGreaterThan(springRate(bottom));
  });
});

describe("what a balance rope does to the swinging mass", () => {
  it("leaves what hangs on the rope near enough alone across a wind", () => {
    const low = hangingAt(bolsover, 0);
    const high = hangingAt(bolsover, windLength(bolsover));
    expect(Math.abs(high - low) / low).toBeLessThan(0.01);
  });

  it("makes the mass to be retarded grow as the conveyance rises", () => {
    const low = bounceMass(hangAt(bolsover, 0));
    const high = bounceMass(hangAt(bolsover, windLength(bolsover)));
    expect(high).toBeGreaterThan(low);
  });

  it("lets it fall instead where there is no balance rope", () => {
    const low = bounceMass(hangAt(whealJane, 0));
    const high = bounceMass(hangAt(whealJane, windLength(whealJane)));
    expect(high).toBeLessThan(low);
  });

  it("adds every metre of itself and a third of every metre wound up", () => {
    const up = 600;
    const one = hangAt(bolsover, up);
    const own = massPerMetre(bolsover.rope) * bolsover.ropes * one.length;
    expect(bounceMass(one)).toBeCloseTo(one.carried + bolsover.balance * up + own / 3, 2);
  });
});

describe("where in a wind an emergency stop is worst", () => {
  it("is at the bank on a balanced winder, where the balance rope is all hanging", () => {
    expect(worstShock(bolsover).up).toBeGreaterThan(windLength(bolsover) - 1);
    expect(worstShock(bolsover).up).toBeLessThanOrEqual(windLength(bolsover));
  });

  it("is at the pit bottom on one with no balance rope, where the winding rope is", () => {
    expect(worstShock(whealJane).up).toBeLessThan(1);
    expect(worstShock(whealJane).up).toBeGreaterThanOrEqual(0);
  });

  it("is at the bank on the four-rope friction winder, which carries one too", () => {
    expect(worstShock(zollverein).up).toBeGreaterThan(windLength(zollverein) - 1);
    expect(worstShock(zollverein).up).toBeLessThanOrEqual(windLength(zollverein));
  });

  it("gives back the factor found at that point and not at any other", () => {
    for (const one of [bolsover, whealJane, zollverein]) {
      const found = worstShock(one);
      const there = shockFactor(hangAt(one, found.up), EMERGENCY_BRAKE);
      expect(found.factor).toBeLessThanOrEqual(there + 1e-6);
      expect(found.factor).toBeGreaterThan(0);
    }
  });

  it("is no better anywhere else in the wind", () => {
    const found = worstShock(bolsover);
    for (const up of [0, 200, 500, 800, 942]) {
      const there = shockFactor(hangAt(bolsover, up), EMERGENCY_BRAKE);
      expect(found.factor).toBeLessThanOrEqual(there + 1e-6);
    }
  });

  it("takes the worst rope of a set and not the mean of them", () => {
    const found = worstShock(zollverein);
    const even = shockFactor(hangAt(zollverein, found.up), EMERGENCY_BRAKE);
    expect(found.factor).toBeLessThan(even);
    expect(found.factor).toBeCloseTo(even / 1.1, 3);
  });

  it("cuts a single rope by nothing, there being nothing for it to be unequal with", () => {
    const found = worstShock(bolsover);
    const even = shockFactor(hangAt(bolsover, found.up), EMERGENCY_BRAKE);
    expect(found.factor).toBeCloseTo(even, 3);
  });

  it("brakes at the emergency brake and not at some gentler figure", () => {
    const found = worstShock(bolsover);
    const there = hangAt(bolsover, found.up);
    expect(found.factor).toBeCloseTo(shockFactor(there, EMERGENCY_BRAKE), 2);
    expect(found.factor).toBeLessThan(shockFactor(there, EMERGENCY_BRAKE / 2));
  });

});
