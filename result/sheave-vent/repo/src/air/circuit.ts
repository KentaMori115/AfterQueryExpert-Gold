/**
 * What the colliery wants, and how the air is shared out.
 *
 * A fan's duty is not a number somebody chose. It is the largest of
 * three quite separate demands — the men, the coal, and the gas — and
 * the one that decides it changes as a pit gets older: a new pit is
 * decided by its men, a working one by its output, and a gassy one by
 * the gas, from the day it becomes gassy until the day it shuts.
 *
 * And what the fan sends down is not what any district gets. Air takes
 * the easy road, so the short level next to the shaft takes far more
 * than its share and the far face takes almost none, which is why every
 * ventilation plan ever drawn has doors and regulators on it: nearly
 * all of the work is not moving air but stopping it going the wrong
 * way.
 */

import { insist, count, nonNegative, positive, share as checkShare } from "../errors.ts";
import { round, roundDown } from "../units/round.ts";
import { type Shaft, freeArea } from "../shaft/index.ts";
import { type Fan, stiffestFor } from "./fan.ts";
import { FRICTION, inParallel } from "./airway.ts";

/** What one man underground wants, in cubic metres a second. */
export const A_MAN_WANTS = 0.1;

/** And what a tonne of the day's output wants, on top of him. */
export const A_TONNE_WANTS = 0.05;

/** The share of firedamp in the general body that the law will not have passed. */
export const GAS_LIMIT = 0.0125;

/** The deepest shaft this library will take, in metres. */
export const DEEPEST_SHAFT = 4200;

/** The air a stated number of men underground want. */
export function forMen(men: number): number {
  count(men, "men");
  return round(men * A_MAN_WANTS, 3);
}

/** The air a stated day's output wants. */
export function forOutput(tonnes: number): number {
  nonNegative(tonnes, "tonnes");
  return round(tonnes * A_TONNE_WANTS, 3);
}

/**
 * The air a gas make wants, in cubic metres a second.
 *
 * The make divided by the share it is allowed to reach. It is the
 * demand that has no upper end to it: a pit whose make doubles wants
 * twice the air, and there is a make beyond which no fan that will fit
 * in the fan house is enough, at which point the seam is not worked.
 */
export function toDilute(gas: number, limit = GAS_LIMIT): number {
  nonNegative(gas, "gas");
  positive(limit, "limit");
  checkShare(limit, "limit");
  return round(gas / limit, 3);
}

/** The most of the three, which is what the fan is asked for. */
export function wanted(men: number, tonnes: number, gas: number, limit = GAS_LIMIT): number {
  return round(Math.max(forMen(men), forOutput(tonnes), toDilute(gas, limit)), 3);
}

/**
 * Which of the three demands is deciding it.
 *
 * The men, the coal or the gas, and the answer is worth having on the
 * sheet beside the number: a pit that is decided by its men gets no
 * more air by winding less coal, and a pit decided by its gas gets none
 * by sending fewer men.
 */
export function decidedBy(men: number, tonnes: number, gas: number, limit = GAS_LIMIT): string {
  const most = wanted(men, tonnes, gas, limit);
  if (toDilute(gas, limit) >= most) return "gas";
  if (forOutput(tonnes) >= most) return "coal";
  return "men";
}



/**
 * How a quantity shares itself between roads side by side.
 *
 * Every road carries the same pressure, so the air divides as one over
 * the root of each resistance and not as one over each. The easy road
 * takes more than people expect and the hard one less, and a district
 * on the end of a long tight road can be getting a tenth of what the
 * plan says it is getting.
 *
 * The root is why splitting works at all. Two roads of the same
 * resistance side by side are a quarter of one of them and not a half,
 * so a colliery that drives a second road to a district has not halved
 * what that district costs the fan, it has quartered it — and a
 * colliery whose second road has fallen in has not lost half of the
 * air down there, it has lost three quarters of the easy part of it.
 */
export function splitBetween(quantity: number, resistances: readonly number[]): number[] {
  positive(quantity, "quantity");
  const whole = inParallel(resistances);
  const pressure = whole * quantity * quantity;
  return resistances.map((each) => round(Math.sqrt(pressure / each), 3));
}

/**
 * A regulator is a door with a hole in it and it is the cheapest thing
 * in a ventilation plan, which is why plans are full of them. It is
 * also the most wasteful: every regulator on a road is pressure the fan
 * made and the colliery threw away, and a plan with a regulator on
 * every road but one is a plan whose fan is a size larger than the pit
 * needed. The alternative is a road widened or a second one driven,
 * which costs more once and nothing thereafter.
 */

/**
 * The regulator a branch wants, in resistance.
 *
 * A door part open, put in the road that is taking too much. What it
 * has to add is whatever turns the branch's own resistance into the one
 * that would pass only the wanted quantity at the pressure the branch
 * is under. A negative answer is a road that is already short and wants
 * widening rather than a door.
 */
export function regulatorFor(pressure: number, wanted0: number, branch: number): number {
  positive(pressure, "pressure");
  positive(wanted0, "wanted");
  positive(branch, "branch");
  return round(pressure / (wanted0 * wanted0) - branch, 6);
}

/** Whether a branch needs a regulator at all, or is the one the others are regulated against. */
export function needsRegulating(pressure: number, wanted0: number, branch: number): boolean {
  return regulatorFor(pressure, wanted0, branch) > 0;
}

/**
 * The deepest shaft of that section a fan will still ventilate, in
 * metres.
 *
 * The resistance of a shaft grows with its depth and nothing else does,
 * so there is a depth at which the crossing falls exactly on the
 * quantity wanted and a metre more is a pit short of air. Taken to the
 * metre below, because the metre above is the one that does not work,
 * and never past the deepest shaft this library will take at all: on a
 * wide shaft behind slack workings the arithmetic runs away to depths
 * nobody has ever sunk to, and an answer of eleven thousand metres is
 * a statement about shafts being cheap airways rather than about any
 * shaft anybody could put down.
 */
export function deepestVentilated(
  one: Fan,
  section: number,
  perimeter: number,
  wanted0: number,
  workings = 0,
  friction = FRICTION,
): number {
  positive(section, "section");
  positive(perimeter, "perimeter");
  nonNegative(workings, "workings");
  positive(friction, "friction");
  const stiffest = stiffestFor(one, wanted0);
  const left = stiffest - workings;
  insist(left > 0, "that fan will not ventilate those workings at any depth at all", "workings");
  const aMetre = (friction * perimeter) / (section * section * section);
  return roundDown(Math.min(left / aMetre, DEEPEST_SHAFT), 0);
}


/** The circuit described in a line. */
export function describeCircuit(men: number, tonnes: number, gas: number): string {
  return `${wanted(men, tonnes, gas)} m³/s, and it is the ${decidedBy(men, tonnes, gas)} that wants it`;
}
