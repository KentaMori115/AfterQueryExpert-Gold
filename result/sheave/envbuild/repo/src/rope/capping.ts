/**
 * How a rope is attached to what it lifts, which is where ropes fail.
 *
 * A winding rope does not part in the middle. It parts at the capel —
 * the socket at the bottom end where the wires are splayed out and set
 * in white metal — because that is where the rope is bent, worked and
 * corroded all at once, and because the twenty metres above the capel
 * do every wind while the rest of the rope does one wind in a hundred.
 *
 * So the capel is remade on a fixed interval whether it needs it or
 * not, and a length is cut off the end each time. That shortening is
 * the reason a winding rope has to be ordered longer than the shaft,
 * and the reason it is eventually too short to reach the bottom while
 * being perfectly sound everywhere else.
 */

import { WindingError, count, insist, nonNegative, positive, within } from "../errors.ts";
import { round, roundDown, roundUp } from "../units/round.ts";
import { type Rope, breakingLoad } from "./construction.ts";

/** How a rope is terminated. */
export type Capping = "white metal" | "wedge" | "bulldog" | "splice";

/** The cappings a colliery uses, and what each keeps of the rope's strength. */
export const CAPPINGS: Readonly<Record<Capping, number>> = {
  "white metal": 1,
  wedge: 0.8,
  bulldog: 0.75,
  splice: 0.9,
};

/** A capping by name, or a refusal that says which are known. */
export function cappingNamed(name: string): Capping {
  const found = (Object.keys(CAPPINGS) as Capping[]).find((each) => each === name.trim());
  if (found === undefined) {
    throw new WindingError(`${name} is not a capping this library knows (${Object.keys(CAPPINGS).join(", ")})`, "capping");
  }
  return found;
}

/**
 * What the rope stands at its termination, in kilonewtons.
 *
 * A white metal capel is the only one that keeps the whole of it, which
 * is why it is the only one allowed on a winding rope. The others are
 * for guide ropes and for the balance rope, where the load is a
 * fraction of the breaking load and the convenience of a wedge socket
 * is worth the fifth it costs.
 */
export function heldBy(one: Rope, how: Capping): number {
  return round(breakingLoad(one) * CAPPINGS[how], 2);
}

/** Whether a capping keeps enough of the rope for a winding duty. */
export function goodForWinding(how: Capping): boolean {
  return CAPPINGS[how] >= 1;
}

/** How often a capel is remade, in months. */
export const RECAP_MONTHS = 6;

/** How much rope a recapping takes off the end, in metres. */
export const CUT_OFF = 3;

/**
 * The rope that has to be ordered beyond the wind, in metres.
 *
 * The headgear, the dead turns on the drum, and enough spare end to be
 * cut back at every recapping for the life of the rope. The last of
 * those is the one that is forgotten, and forgetting it means ordering
 * a rope that is a year short of its own fatigue life.
 */
export function orderExtra(months: number, cut = CUT_OFF, every = RECAP_MONTHS): number {
  positive(months, "months");
  positive(cut, "cut");
  positive(every, "every");
  return round(Math.ceil(months / every) * cut, 2);
}

/** How many recappings a rope's life contains. */
export function recappings(months: number, every = RECAP_MONTHS): number {
  positive(months, "months");
  positive(every, "every");
  return Math.ceil(months / every);
}

/** The rope length to order for a stated wind and life, in metres. */
export function orderLength(wind: number, headgear: number, deadTurns: number, months: number): number {
  positive(wind, "wind");
  nonNegative(headgear, "headgear");
  nonNegative(deadTurns, "deadTurns");
  return roundUp(wind + headgear + deadTurns + orderExtra(months), 0);
}

/**
 * How long a rope of a stated length will serve before it is too short,
 * in months.
 *
 * A rope shortened three metres every six months is a rope with a
 * calendar on it, and the calendar is often shorter than the fatigue
 * life. It is the reason a colliery orders more rope than it appears to
 * need and the reason nobody who has run out of rope ever forgets.
 */
export function servesFor(length: number, wanted: number, cut = CUT_OFF, every = RECAP_MONTHS): number {
  positive(length, "length");
  positive(wanted, "wanted");
  const spare = length - wanted;
  insist(spare >= 0, "that rope is already too short for the wind", "length");
  return roundDown((Math.floor(spare / cut) + 1) * every, 0);
}

/**
 * The share of a rope's length that does most of the work.
 *
 * The part that passes over the sheave on every wind, which is the
 * length between the capel and the drum at the moment the conveyance is
 * at the bank — a few tens of metres out of hundreds. Everything else
 * bends round the drum once a wind and that end bends round the sheave
 * once a wind as well, so it fatigues at twice the rate and wears out
 * first.
 */
export function busyLength(headgear: number, deadTurns: number): number {
  nonNegative(headgear, "headgear");
  nonNegative(deadTurns, "deadTurns");
  return round(headgear + deadTurns, 2);
}

/** The share of the whole rope that busy length is. */
export function busyShare(headgear: number, deadTurns: number, whole: number): number {
  positive(whole, "whole");
  return round(busyLength(headgear, deadTurns) / whole, 4);
}

/**
 * How far a rope should be shifted along to spread the wear, in metres.
 *
 * The other answer to the busy length, and the cheaper one. Cutting a
 * few metres off the capel end moves the whole rope through the machine
 * and puts fresh rope where the sheave was working — which is why the
 * cut-back at recapping is not merely maintenance but the principal
 * means of getting a full life out of a rope.
 */
export function shiftFor(headgear: number, deadTurns: number, times: number): number {
  count(times, "times");
  positive(times, "times");
  return round(busyLength(headgear, deadTurns) / times, 2);
}

/** The white metal a capel of a stated rope takes, in kilograms. */
export function whiteMetal(one: Rope): number {
  // The cone is about four rope diameters long and two across at the
  // mouth, and it is filled with a lead-antimony alloy at 10.5 tonnes a
  // cubic metre less the steel in it.
  const cone = (Math.PI / 12) * ((2 * one.diameter) ** 2 + 2 * one.diameter * one.diameter + one.diameter ** 2) * 4 * one.diameter;
  return round(cone * 1e-9 * 10_500 * 0.55, 3);
}

/** How long a capel takes to make, in hours. */
export function cappingHours(one: Rope): number {
  return round(3 + one.diameter / 12, 1);
}

/** Whether a capping regime meets what the rules ask. */
export function capped(every: number, most = RECAP_MONTHS): boolean {
  positive(every, "every");
  positive(most, "most");
  return every <= most;
}

/** The termination described in a line. */
export function describeCapping(one: Rope, how: Capping): string {
  return (
    `a ${how} capel holds ${heldBy(one, how)} kN of ${breakingLoad(one)}, ` +
    `takes ${whiteMetal(one)} kg of metal and ${cappingHours(one)} hours to make`
  );
}

/** The share of the rope's strength a capping keeps. */
export function keeps(how: Capping): number {
  const found = CAPPINGS[how];
  within(found, 0, 1, "capping");
  return found;
}
