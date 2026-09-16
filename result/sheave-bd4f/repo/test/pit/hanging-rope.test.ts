/**
 * A rope hanging in a shaft, taken as a spring.
 *
 * Everything here is about one length of rope with one load on the end
 * of it, and about the two things that follow from a rope being elastic
 * at all: it stretches, by rather more than anybody expects at depth,
 * and it has a period of its own.
 *
 * The figures are checked against each other rather than against a
 * table, because the arithmetic is not in doubt and the places it is
 * rounded to are nobody's business. What is in doubt is which mass goes
 * into which formula, and every case here is arranged so that a wrong
 * answer to that shows up as a wrong number somewhere.
 */

import { describe, expect, it } from "vitest";
import { hang, springRate, wholeStretch, bounceMass, bouncePeriod } from "../../src/rope/index.ts";
import { constructionNamed, massPerMetre, rope, steelArea } from "../../src/rope/construction.ts";
import { YOUNGS } from "../../src/rope/wear.ts";
import { weightOf } from "../../src/units/measure.ts";

const winding = rope(52, constructionNamed("6x36"), 1960);
const locked = rope(52, constructionNamed("locked"), 1960);
const deep = hang({ rope: winding, length: 984, ropes: 1, carried: 17_040, balance: 0 });

function ownMass(one: ReturnType<typeof hang>): number {
  return massPerMetre(one.rope) * one.ropes * one.length;
}

describe("how stiff a hanging rope is", () => {
  it("is the steel in it over the length of it", () => {
    const wanted = (0.55 * YOUNGS * steelArea(winding)) / (1000 * 984);
    expect(springRate(deep)).toBeCloseTo(wanted, 2);
  });

  it("softens in proportion as the rope gets longer", () => {
    const half = hang({ ...deep, length: 492 });
    expect(springRate(half)).toBeCloseTo(2 * springRate(deep), 2);
  });

  it("adds up over the ropes of a set, four being four springs side by side", () => {
    const four = hang({ ...deep, ropes: 4 });
    expect(springRate(four)).toBeCloseTo(4 * springRate(deep), 2);
  });

  it("takes no notice of what is hanging on it", () => {
    const heavier = hang({ ...deep, carried: 40_000, balance: 9_000 });
    expect(springRate(heavier)).toBeCloseTo(springRate(deep), 4);
  });

  it("is stiffer where the wires are locked than where they are laid", () => {
    const one = hang({ ...deep, rope: locked });
    expect(springRate(one)).toBeGreaterThan(springRate(deep));
  });

  it("keeps three quarters of the steel's modulus in a locked coil rope", () => {
    const one = hang({ ...deep, rope: locked });
    const wanted = (0.75 * YOUNGS * steelArea(locked)) / (1000 * 984);
    expect(springRate(one)).toBeCloseTo(wanted, 2);
  });

});

describe("how far it stretches", () => {
  it("gives way under what hangs on it and under half its own weight", () => {
    const wanted = (weightOf(deep.carried) + weightOf(ownMass(deep)) / 2) / springRate(deep);
    expect(wholeStretch(deep)).toBeCloseTo(wanted, 3);
  });

  it("comes to better than a metre on a deep winder", () => {
    expect(wholeStretch(deep)).toBeGreaterThan(1);
    expect(wholeStretch(deep)).toBeLessThan(3);
  });

  it("counts a balance rope as something hanging on it", () => {
    const balanced = hang({ ...deep, balance: 9_363 });
    const wanted = (weightOf(deep.carried + 9_363) + weightOf(ownMass(deep)) / 2) / springRate(deep);
    expect(wholeStretch(balanced)).toBeCloseTo(wanted, 3);
    expect(wholeStretch(balanced)).toBeGreaterThan(wholeStretch(deep));
  });

  it("stretches twice as far under twice the load", () => {
    const heavier = hang({ ...deep, carried: 34_080 });
    const own = weightOf(ownMass(deep)) / 2 / springRate(deep);
    expect(wholeStretch(heavier) - own).toBeCloseTo(2 * (wholeStretch(deep) - own), 3);
  });

  it("counts its own weight at half, the top of it carrying all and the bottom none", () => {
    const bare = hang({ ...deep, carried: 1 });
    const asIfHung = weightOf(ownMass(deep)) / springRate(deep);
    expect(wholeStretch(bare)).toBeLessThan(asIfHung);
    expect(wholeStretch(bare)).toBeCloseTo(asIfHung / 2, 2);
  });
});

describe("what actually swings on the end of the spring", () => {
  it("is the conveyance, the whole balance rope, and a third of the winding rope", () => {
    const balanced = hang({ ...deep, balance: 9_363 });
    expect(bounceMass(balanced)).toBeCloseTo(17_040 + 9_363 + ownMass(deep) / 3, 2);
  });

  it("counts a third of the winding rope and not the whole of it", () => {
    expect(bounceMass(deep)).toBeLessThan(17_040 + ownMass(deep));
    expect(bounceMass(deep)).toBeCloseTo(17_040 + ownMass(deep) / 3, 2);
  });

  it("counts the whole of a balance rope and not a third of it", () => {
    const balanced = hang({ ...deep, balance: 9_000 });
    expect(bounceMass(balanced) - bounceMass(deep)).toBeCloseTo(9_000, 2);
  });

  it("counts every rope of a set", () => {
    const four = hang({ ...deep, ropes: 4 });
    expect(bounceMass(four)).toBeCloseTo(17_040 + (4 * ownMass(deep)) / 3, 2);
  });

  it("gets lighter as an unbalanced conveyance rises", () => {
    const low = hang({ ...deep, length: 984 });
    const high = hang({ ...deep, length: 42 });
    expect(bounceMass(high)).toBeLessThan(bounceMass(low));
  });

  it("gets heavier as a balanced one rises, which is the other way about", () => {
    const low = hang({ ...deep, length: 984, balance: 0 });
    const high = hang({ ...deep, length: 42, balance: 9.94 * 942 });
    expect(bounceMass(high)).toBeGreaterThan(bounceMass(low));
  });
});

describe("the period it bounces at", () => {
  it("is that mass on that spring and nothing else", () => {
    const wanted = 2 * Math.PI * Math.sqrt(bounceMass(deep) / (springRate(deep) * 1000));
    expect(bouncePeriod(deep)).toBeCloseTo(wanted, 3);
  });

  it("is a few seconds on a deep winder, slow enough to watch", () => {
    expect(bouncePeriod(deep)).toBeGreaterThan(1.5);
    expect(bouncePeriod(deep)).toBeLessThan(6);
  });

  it("shortens as the conveyance rises and the spring hardens", () => {
    const high = hang({ ...deep, length: 42 });
    expect(bouncePeriod(high)).toBeLessThan(bouncePeriod(deep));
  });

  it("is longer on a balanced winder than on the same one without the balance rope", () => {
    const balanced = hang({ ...deep, balance: 9_363 });
    expect(bouncePeriod(balanced)).toBeGreaterThan(bouncePeriod(deep));
  });

  it("is shorter on a locked coil rope, which gives less", () => {
    const one = hang({ ...deep, rope: locked });
    expect(bouncePeriod(one)).toBeLessThan(bouncePeriod(deep));
  });
});

describe("a set of ropes pulling together", () => {
  it("stretches the same under its own weight as one rope does", () => {
    const four = hang({ ...deep, ropes: 4 });
    const own = weightOf(ownMass(deep)) / 2 / springRate(deep);
    const ownOfFour = weightOf(ownMass(four)) / 2 / springRate(four);
    expect(ownOfFour).toBeCloseTo(own, 4);
  });

  it("stretches a quarter as far under the load it carries", () => {
    const four = hang({ ...deep, ropes: 4 });
    const oneOwn = weightOf(ownMass(deep)) / 2 / springRate(deep);
    const fourOwn = weightOf(ownMass(four)) / 2 / springRate(four);
    expect(wholeStretch(four) - fourOwn).toBeCloseTo((wholeStretch(deep) - oneOwn) / 4, 4);
  });

  it("swings more mass and yet bounces quicker, the spring having hardened more", () => {
    const four = hang({ ...deep, ropes: 4 });
    expect(bounceMass(four)).toBeGreaterThan(bounceMass(deep));
    expect(bouncePeriod(four)).toBeLessThan(bouncePeriod(deep));
  });
});

describe("the two ends of one shaft", () => {
  const bottom = hang({ rope: winding, length: 984, ropes: 1, carried: 17_040, balance: 0 });
  const bank = hang({ rope: winding, length: 42, ropes: 1, carried: 17_040, balance: 9.94 * 942 });

  it("hangs near enough the same weight at both, which is what a balance rope is for", () => {
    const low = weightOf(bottom.carried + bottom.balance + ownMass(bottom));
    const high = weightOf(bank.carried + bank.balance + ownMass(bank));
    expect(Math.abs(high - low) / low).toBeLessThan(0.01);
  });

  it("swings a good deal more at the bank than at the pit bottom", () => {
    expect(bounceMass(bank)).toBeGreaterThan(bounceMass(bottom));
  });

  it("bounces faster at the bank all the same, the spring having hardened more", () => {
    expect(bouncePeriod(bank)).toBeLessThan(bouncePeriod(bottom));
  });

  it("has next to no stretch left in it at the bank", () => {
    expect(wholeStretch(bank)).toBeLessThan(wholeStretch(bottom) / 10);
  });
});
