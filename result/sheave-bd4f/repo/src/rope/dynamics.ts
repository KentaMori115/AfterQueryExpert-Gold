/**
 * The rope as a spring, which is what it is and what nothing else in
 * this library has so far admitted.
 *
 * Every other module treats a winding rope as a string of no thickness
 * that either holds or does not. It is nothing of the kind. A kilometre
 * of fifty-two millimetre rope with a loaded skip on the end of it
 * stretches better than a metre and a half, and it stretches slowly
 * enough to be watched: a skip landed at the pit bottom settles onto
 * the keps two or three seconds after the winder has stopped, and the
 * banksman at the top sees nothing at all happen for the same two or
 * three seconds after he sets it away.
 *
 * Three things come out of that and all of them matter.
 *
 * The first is the stretch itself, which is why a deep winder's
 * landings are never where the drum says they are and why creeping
 * exists at all. The second is that the rope has a period of its own,
 * so a wind that stops does not stop: it bounces, at something between
 * two and five seconds a swing, with nothing to damp it but the
 * friction of the guides. The third is the one that puts ropes on the
 * scrapheap, and it is in `shock.ts`.
 *
 * The modulus wanted here is the rope's and not the steel's. A laid
 * rope stretches partly because its wires stretch and partly because
 * the lay closes up, so it gives more than a solid bar of the same
 * steel area does — a little over half as stiff for round strand, three
 * quarters for locked coil, whose wires lie nearly along the rope. It
 * is a fitted figure and it is the one figure here worth arguing with.
 */

import { insist, nonNegative, positive, within } from "../errors.ts";
import { round } from "../units/round.ts";
import { weightOf } from "../units/measure.ts";
import { type Rope, massPerMetre, steelArea } from "./construction.ts";
import { YOUNGS } from "./wear.ts";

/**
 * How much of steel's modulus a round strand rope keeps.
 *
 * Fitted to a 6x36 rope measured at 110 kN/mm² of steel area against
 * the 200 the wire itself is drawn to. The missing half is the lay
 * closing: every wire in the rope runs helically and a pull straightens
 * it a little before it stretches it, and a rope that has been worked
 * for a year is stiffer than a new one for that reason alone.
 */
export const LAID_MODULUS = 0.55;

/**
 * And how much a locked coil rope keeps.
 *
 * Three quarters, because its shaped wires interlock and lie nearly
 * along the rope, so there is very little lay left to close. It is
 * stiffer, which is an advantage at depth and the reason it is used
 * there — and it is also why a locked coil rope is unforgiving of a
 * shock, since a spring that gives less takes more.
 */
export const LOCKED_MODULUS = 0.75;

/**
 * The modulus a rope actually stretches to, in newtons a square
 * millimetre of steel area.
 *
 * Not the modulus of steel, which is what a first calculation uses and
 * which gives a stretch half of what a deep winder really shows.
 */
export function pullModulus(one: Rope): number {
  const share = one.construction.strands === 1 ? LOCKED_MODULUS : LAID_MODULUS;
  return round(YOUNGS * share, 1);
}

/**
 * A rope hanging in a shaft with something on the end of it.
 *
 * The length is from the sheave to the conveyance and not the depth of
 * the shaft: the rope between the sheave and the bank is under the same
 * tension and stretches with the rest of it, and on a shaft with a
 * forty metre headgear that is another forty metres of spring.
 */
export interface Hang {
  /** The rope it hangs on. */
  readonly rope: Rope;
  /** From the sheave down to the conveyance, in metres. */
  readonly length: number;
  /** How many ropes are pulling together. */
  readonly ropes: number;
  /** What is on the end of them, in kilograms. */
  readonly carried: number;
  /** The balance rope hanging under that, in kilograms. */
  readonly balance: number;
}

/** A hang, checked. */
export function hang(over: Partial<Hang> & Pick<Hang, "rope" | "length" | "carried">): Hang {
  const found: Hang = {
    rope: over.rope,
    length: over.length,
    ropes: over.ropes ?? 1,
    carried: over.carried,
    balance: over.balance ?? 0,
  };
  positive(found.length, "length");
  within(found.ropes, 1, 6, "ropes");
  positive(found.carried, "carried");
  nonNegative(found.balance, "balance");
  return found;
}

/**
 * How stiff that hang is, in kilonewtons a metre.
 *
 * The modulus times the steel area over the length, and the ropes of a
 * multi-rope winder add: four ropes are four springs side by side and
 * are four times as stiff as one. The length is on the bottom, which is
 * the whole of what follows — a rope at the pit bottom is a soft spring
 * and the same rope at the bank is a hard one, and the same wind is a
 * different mechanical problem at the two ends of it.
 */
export function springRate(one: Hang): number {
  const area = steelArea(one.rope) * one.ropes;
  return round((pullModulus(one.rope) * area) / (1000 * one.length), 4);
}

/** How far a stated pull stretches it, in metres. */
export function stretchUnder(one: Hang, pull: number): number {
  nonNegative(pull, "pull");
  const rate = springRate(one);
  insist(rate > 0, "that rope has no stiffness at all", "length");
  return round(pull / rate, 4);
}

/**
 * How far the rope's own weight stretches it, in metres.
 *
 * Half what the same weight hung on the end would, because the top of
 * the rope carries all of it and the bottom of it carries none. It is a
 * small figure on a shallow shaft and it is a quarter of the whole
 * stretch at a thousand metres, at which point a colliery that has
 * ignored it is landing its cages a hand's breadth out.
 */
export function ownStretch(one: Hang): number {
  const own = weightOf(massPerMetre(one.rope) * one.ropes * one.length);
  return round(stretchUnder(one, own / 2), 4);
}

/** What hangs on the rope, in kilonewtons, the rope itself included. */
export function staticPull(one: Hang): number {
  const own = massPerMetre(one.rope) * one.ropes * one.length;
  return round(weightOf(one.carried + one.balance + own), 4);
}

/**
 * How far the whole arrangement stretches, in metres.
 *
 * The load on the end, the balance rope under it, and the winding
 * rope's own weight at half effect. On a deep winder it is the figure
 * that decides how much creep the landing wants, and it is not the same
 * at the two ends of the wind, which is the awkward part: a shaft is
 * landed accurately at one end and approximately at the other unless
 * somebody has thought about it.
 */
export function wholeStretch(one: Hang): number {
  return round(stretchUnder(one, weightOf(one.carried + one.balance)) + ownStretch(one), 4);
}

/**
 * How much of a hanging rope's own mass moves with the conveyance.
 *
 * A third. The rope is a spring with its mass spread along it, and the
 * bottom of it moves with the load while the top of it does not move at
 * all; the third is what an equal-energy argument gives and it is close
 * enough to measurement that nobody has ever needed a better one.
 */
export const MOVING_THIRD = 1 / 3;

/**
 * What is actually swinging on the end of the spring, in kilograms.
 *
 * The conveyance, a third of the winding rope, and the whole of the
 * balance rope — the last of those being the part that surprises
 * people. A balance rope hangs from the conveyance rather than from the
 * sheave, so every metre of it goes where the conveyance goes and every
 * metre of it counts. It is the reason a balanced winder bounces harder
 * at the top of the shaft than at the bottom, which is the opposite way
 * round from an unbalanced one and is not what anybody expects.
 */
export function bounceMass(one: Hang): number {
  const own = massPerMetre(one.rope) * one.ropes * one.length;
  return round(one.carried + one.balance + own * MOVING_THIRD, 3);
}

/**
 * The period the conveyance bounces at, in seconds.
 *
 * The ordinary period of a mass on a spring, with the mass above and
 * the stiffness above it. Two to five seconds on anything deep, which
 * is slow enough to see and slow enough to be dangerous: it is of the
 * same order as the time a brake takes to stop a wind, so a stop and a
 * bounce arrive together and the second of them lands on top of the
 * first.
 */
export function bouncePeriod(one: Hang): number {
  const rate = springRate(one) * 1000;
  const mass = bounceMass(one);
  insist(rate > 0 && mass > 0, "that hang has nothing to bounce", "carried");
  return round(2 * Math.PI * Math.sqrt(mass / rate), 3);
}

/** How many times a minute it swings. */
export function bouncesAMinute(one: Hang): number {
  const period = bouncePeriod(one);
  insist(period > 0, "that hang has no period at all", "carried");
  return round(60 / period, 2);
}

/**
 * How far the conveyance travels while the rope is taking up the load,
 * in metres.
 *
 * A quarter of a period at the speed being wound at. It is the figure
 * that says why a deep winder cannot be stopped where it is wanted: at
 * fifteen metres a second and a two and a half second period the answer
 * is nine metres, and nine metres is the whole of an inset.
 */
export function slackRun(one: Hang, speed: number): number {
  positive(speed, "speed");
  return round((speed * bouncePeriod(one)) / 4, 3);
}

/**
 * The depth at which a rope's own stretch reaches a stated share of the
 * whole, in metres.
 *
 * Searched rather than solved, because the carried load stretches the
 * rope in proportion to the length and the rope's own weight stretches
 * it as the square of it, so the share moves with depth in a way that
 * no single figure describes. It is the depth below which the rope
 * itself is the thing being weighed.
 */
export function ownStretchReaches(one: Hang, share = 0.25): number {
  within(share, 0.01, 0.99, "share");
  for (let at = 10; at <= 4000; at += 10) {
    const trial = hang({ ...one, length: at });
    const whole = wholeStretch(trial);
    if (whole > 0 && ownStretch(trial) / whole >= share) return at;
  }
  return 0;
}

/** The spring described in a line. */
export function describeSpring(one: Hang): string {
  return (
    `${round(one.length, 0)} m of rope at ${springRate(one)} kN/m: ` +
    `${wholeStretch(one)} m of stretch, ${bounceMass(one)} kg swinging, ` +
    `${bouncePeriod(one)} s a bounce`
  );
}
