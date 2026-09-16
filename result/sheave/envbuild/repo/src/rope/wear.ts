/**
 * What happens to a rope after it is put on, and when it has to come
 * off.
 *
 * A winding rope does not fail because somebody miscalculated the load.
 * It fails because it has been bent round a drum four hundred thousand
 * times, because the outer wires have worn flat where they touch the
 * sheave, because water down the shaft has corroded the inside where
 * nobody can look, or because all three at once. The design calculation
 * is the easy half of the subject; this is the other half.
 *
 * The rule that governs it is not an engineer's rule but a statutory
 * one, and it has an odd shape: the factor of safety a rope must be put
 * on at *falls* with the depth of the shaft. That is not a relaxation
 * of standards. It is an admission that at some depth a rope cannot
 * carry both a payload and eight times its own weight, and that a
 * regulation demanding it would forbid deep mining rather than make it
 * safe.
 */

import { WindingError, count, insist, nonNegative, positive, share, within } from "../errors.ts";
import { round, roundDown, roundUp } from "../units/round.ts";
import { depth as checkDepth } from "../errors.ts";
import { type Rope, breakingLoad, massPerMetre, outerWire } from "./construction.ts";

/** The factor of safety a shallow shaft's rope is put on at. */
export const SHALLOW_FACTOR = 8;

/** The factor below which no rope is put on, however deep the shaft. */
export const DEEPEST_FACTOR = 4.5;

/** How fast the statutory factor falls with depth, per metre. */
export const FACTOR_FALLS = 0.0022;

/**
 * The factor of safety a rope must be put on at, for a shaft of a
 * stated depth.
 *
 * Eight at the surface, falling by about a fifth for every hundred
 * metres, and never below four and a half. The shape is the important
 * part: a rule with a single number in it would either be too slack for
 * a shallow shaft or would make a deep one impossible, and the people
 * who wrote it knew which of those was the greater danger.
 */
export function factorFor(depth: number): number {
  checkDepth(depth, "depth");
  return round(Math.max(DEEPEST_FACTOR, SHALLOW_FACTOR - FACTOR_FALLS * depth), 3);
}

/**
 * The factor of safety a rope is actually working at.
 *
 * The breaking load over the static load it carries, which is the
 * payload, the cage, and every metre of rope beneath the sheave. The
 * last of those is what makes the calculation interesting.
 */
export function factorAt(one: Rope, depth: number, hanging: number): number {
  checkDepth(depth, "depth");
  positive(hanging, "hanging");
  const load = hanging + staticRopeLoad(one, depth);
  insist(load > 0, "nothing is hanging on that rope", "hanging");
  return round(breakingLoad(one) / load, 3);
}

/** What the hanging rope itself pulls with, in kilonewtons. */
export function staticRopeLoad(one: Rope, depth: number): number {
  checkDepth(depth, "depth");
  return round((massPerMetre(one) * depth * 9.80665) / 1000, 4);
}

/** Whether the rope meets the factor its shaft's depth demands. */
export function strongEnough(one: Rope, depth: number, hanging: number): boolean {
  return factorAt(one, depth, hanging) >= factorFor(depth);
}

/**
 * The heaviest load a rope may hang at a stated depth, in kilonewtons.
 *
 * The breaking load divided by the statutory factor, less what the rope
 * weighs. It is the number the whole of deep winding turns on, and it
 * goes to nothing at a depth a good deal shallower than the breaking
 * length suggests, because the rope's own weight is inside the factor
 * of safety as well.
 *
 * It does not fall smoothly with depth, and anybody quoting it as a
 * design curve should know why. The statutory factor falls in a
 * straight line and the rope's weight rises in a straight line, and
 * between about eight hundred and fourteen hundred metres the first is
 * falling faster than the second is rising — so over that range a
 * deeper shaft is allowed a *heavier* load than a shallower one. That
 * is an artefact of a straight-line rule rather than a fact about
 * ropes, and the sensible thing to do with it is to take the worst
 * figure across the range rather than the one at the depth in hand.
 */
export function mostHanging(one: Rope, depth: number): number {
  const allowed = breakingLoad(one) / factorFor(depth);
  const own = staticRopeLoad(one, depth);
  const left = allowed - own;
  insist(
    left > 0,
    `a ${one.diameter} mm rope will not carry itself at ${depth} m, let alone anything else`,
    "depth",
  );
  return round(left, 3);
}

/**
 * The deepest shaft a rope will serve while still hanging a stated
 * load, in metres.
 *
 * Nought if it will not hang that load at any depth at all, which is a
 * perfectly ordinary answer and is how the caller finds out that the
 * rope wanted is a larger one rather than a shallower shaft. It is the
 * honest limit of a single-lift shaft, and it is why very deep mines
 * are wound in two stages with a landing halfway: not because the rope
 * would break, but because at that depth the rope is the payload.
 */
export function deepestFor(one: Rope, hanging: number): number {
  positive(hanging, "hanging");
  let best = 0;
  for (let at = 0; at <= 4200; at += 1) {
    if (breakingLoad(one) / factorFor(at) - staticRopeLoad(one, at) >= hanging) best = at;
  }
  return best;
}

/** The least drum or sheave diameter a rope should be bent round. */
export const LEAST_RATIO = 80;

/** And the greater one a locked coil rope wants. */
export const LOCKED_RATIO = 100;

/**
 * The smallest drum a rope should be bent round, in metres.
 *
 * Eighty times the rope diameter for a round strand rope and a hundred
 * for a locked coil, which is not a rule of thumb but the point at
 * which the bending stress in the outer wires stops being small
 * compared with the tension. A drum below it does not fail: the rope
 * does, at a fifth of the life it should have had, and from the inside.
 */
export function leastDrum(one: Rope): number {
  const ratio = one.construction.strands === 1 ? LOCKED_RATIO : LEAST_RATIO;
  return round((one.diameter * ratio) / 1000, 3);
}

/** The ratio a stated drum actually gives that rope. */
export function ratioOf(one: Rope, drum: number): number {
  positive(drum, "drum");
  return round((drum * 1000) / one.diameter, 2);
}

/**
 * The bending stress a drum puts in the outer wires, in newtons a
 * square millimetre.
 *
 * The outer wire is bent round the drum, so its own diameter over the
 * drum's diameter times the modulus of the steel. It is the wire's
 * diameter and not the rope's that appears, which is the whole reason a
 * many-wired construction is used: on the same drum at the same
 * tension, a 6x7 rope carries twice the bending stress a 6x36 does, and
 * the drum that would suit it is one nobody would build.
 */
export function bendingStress(one: Rope, drum: number): number {
  positive(drum, "drum");
  return round((outerWire(one) / (drum * 1000)) * YOUNGS, 1);
}

/** The modulus of the steel, in newtons a square millimetre. */
export const YOUNGS = 200_000;

/**
 * The life a rope may be expected to give, in winds.
 *
 * Bending fatigue goes as a high power of the ratio, so a drum ten per
 * cent larger is worth rather more than ten per cent of life. Four
 * hundred thousand winds is an ordinary figure and it is between one
 * and two years at a colliery working three shifts.
 */
export function lifeIn(one: Rope, drum: number, bendsAWind = 2): number {
  count(bendsAWind, "bendsAWind");
  positive(bendsAWind, "bendsAWind");
  const ratio = ratioOf(one, drum);
  insist(ratio > 20, "no rope survives a drum that small at all", "drum");
  // Fitted so that a round strand rope on a drum at eighty to one, bent
  // twice a wind, gives four hundred thousand winds.
  return roundDown((LIFE_AT_EIGHTY * (ratio / LEAST_RATIO) ** 3.5) / bendsAWind, 0);
}

/** The winds a rope gives on a drum at the least ratio, bent once. */
export const LIFE_AT_EIGHTY = 800_000;

/** How many broken wires in a lay length put a rope off. */
export const BROKEN_WIRES = 0.05;

/**
 * How many broken wires in one lay length condemn a rope.
 *
 * Five per cent of the outer wires, which for a 6x36 rope is a little
 * over twenty and for a 6x7 is two. That is the whole argument for a
 * many-wired construction where a rope is inspected by eye: a 6x7 rope
 * is condemned by damage a 6x36 rope would not notice, and a 6x7 rope
 * that has broken two wires has lost a great deal more of its strength.
 */
export function condemningBreaks(one: Rope, share0 = BROKEN_WIRES): number {
  share(share0, "share");
  const outer = one.construction.strands * one.construction.wires;
  return Math.max(2, Math.round(outer * share0));
}

/** How much diameter a rope may lose before it comes off, as a share. */
export const WORN_DIAMETER = 0.07;

/**
 * The diameter at which a rope is condemned for wear, in millimetres.
 *
 * Seven per cent under nominal, measured over the crowns. It sounds
 * generous and is not: seven per cent of diameter is fourteen of area
 * and the wear is all on the outer wires, which are the ones carrying
 * the bending as well.
 */
export function wornOut(one: Rope, worn = WORN_DIAMETER): number {
  share(worn, "worn");
  return round(one.diameter * (1 - worn), 2);
}

/**
 * What a rope worn to a stated diameter will still stand, in
 * kilonewtons.
 *
 * The loss is taken on area, not on diameter, which is the point: a
 * rope that has lost three millimetres of a forty has lost fourteen per
 * cent of what it will hold, and a factor of safety of eight has become
 * one of seven.
 */
export function wornStrength(one: Rope, measured: number): number {
  positive(measured, "measured");
  insist(measured <= one.diameter, "a rope does not grow", "measured");
  return round(breakingLoad(one) * (measured / one.diameter) ** 2, 2);
}

/** Whether a rope measured at a stated diameter is still to be worked. */
export function stillGood(one: Rope, measured: number, depth: number, hanging: number): boolean {
  if (measured < wornOut(one)) return false;
  const load = hanging + staticRopeLoad(one, depth);
  insist(load > 0, "nothing is hanging on that rope", "hanging");
  return wornStrength(one, measured) / load >= factorFor(depth);
}

/**
 * How much corrosion allowance a shaft's water asks for, as a share of
 * the rope's life.
 *
 * A dry shaft takes none and a wet one takes half, and there is nothing
 * to be done about it but change the rope sooner. Galvanising helps and
 * costs a tenth of the strength, which at depth is a tenth of the
 * payload.
 */
export function wetShaftLife(one: Rope, drum: number, wetness = 0.5): number {
  share(wetness, "wetness");
  return roundDown(lifeIn(one, drum) * (1 - wetness), 0);
}

/** How long a life is, in months, at a stated number of winds a day. */
export function lifeInMonths(winds: number, aDay: number): number {
  positive(aDay, "aDay");
  nonNegative(winds, "winds");
  return round(winds / aDay / 30.44, 2);
}

/** The rope's condition in a line, for an inspection book. */
export function describeWear(one: Rope, measured: number, depth: number, hanging: number): string {
  return (
    `${measured} mm against ${one.diameter} nominal: ` +
    `${wornStrength(one, measured)} kN left, working at ${round(wornStrength(one, measured) / (hanging + staticRopeLoad(one, depth)), 2)} ` +
    `against a required ${factorFor(depth)}`
  );
}

/** The rope diameter a shaft and a load demand, in millimetres. */
export function diameterForDuty(depth: number, hanging: number, made: Rope["construction"], grade: number): number {
  checkDepth(depth, "depth");
  positive(hanging, "hanging");
  for (let at = 6; at <= 90; at += 1) {
    const trial: Rope = { diameter: at, construction: made, grade };
    if (factorAt(trial, depth, hanging) >= factorFor(depth)) return at;
  }
  throw new WindingError(`no single rope this library knows will hang ${hanging} kN at ${depth} m`, "depth");
}

/** How much of a rope's strength its own weight is using, as a share. */
export function ownShare(one: Rope, depth: number, hanging: number): number {
  const own = staticRopeLoad(one, depth);
  const load = own + hanging;
  insist(load > 0, "nothing is hanging on that rope", "hanging");
  return round(own / load, 4);
}

/**
 * The heaviest load allowed anywhere in a range of depths, taken at its
 * worst, in kilonewtons.
 *
 * What `mostHanging` should be read as when the answer is going to be
 * used as a design figure. It walks the range and takes the least,
 * which removes the straight-line rule's artefact at a cost of a few
 * kilonewtons in the middle of it.
 */
export function mostHangingOver(one: Rope, from: number, to: number): number {
  checkDepth(from, "from");
  checkDepth(to, "to");
  insist(to >= from, "that range runs backwards", "to");
  let least = Number.POSITIVE_INFINITY;
  for (let at = Math.floor(from); at <= Math.ceil(to); at += 1) {
    const allowed = breakingLoad(one) / factorFor(at) - staticRopeLoad(one, at);
    if (allowed < least) least = allowed;
  }
  insist(least > 0, "that rope will not carry itself over the whole of that range", "to");
  return round(least, 3);
}

/** Whether a drum is large enough for the rope on it. */
export function bigEnough(one: Rope, drum: number): boolean {
  return roundUp(drum, 4) >= leastDrum(one);
}
