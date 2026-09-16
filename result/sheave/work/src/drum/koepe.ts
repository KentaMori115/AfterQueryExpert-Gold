/**
 * The friction winder, which does not coil the rope at all.
 *
 * Koepe's idea was to stop winding the rope onto anything. The rope
 * passes over a wheel with a friction lining in its groove, down one
 * side of the shaft to one conveyance and down the other side to the
 * other, and the wheel drives it by friction alone. Nothing is coiled,
 * so the depth of the shaft costs nothing in drum size; the fleet angle
 * does not exist; and the wheel can be a third the diameter of the drum
 * it replaces.
 *
 * What it costs is the thing that decides whether it can be used at
 * all. Friction will only hold if the tension on the two sides stays
 * within a ratio, and that ratio is fixed by the lining and the wrap.
 * A cage winder, where one side hangs a loaded cage and the other an
 * empty one, is right at the edge of it — which is why friction winders
 * are used with skips and with balance ropes and rarely without either.
 */

import { insist, nonNegative, positive, share, within } from "../errors.ts";
import { round } from "../units/round.ts";
import { weightOf } from "../units/measure.ts";
import { type Rope, leastDrum, massPerMetre } from "../rope/index.ts";

/** A friction winder, as built. */
export interface Koepe {
  /** The wheel diameter, in metres. */
  readonly diameter: number;
  /** How far the rope wraps round it, in degrees. */
  readonly wrap: number;
  /** The coefficient of friction of the lining. */
  readonly friction: number;
  /** How many ropes it drives. */
  readonly ropes: number;
}

/** A friction winder, checked. */
export function koepe(diameter = 5, wrap = 180, friction = 0.25, ropes = 4): Koepe {
  within(diameter, 1, 12, "diameter");
  within(wrap, 90, 240, "wrap");
  within(friction, 0.1, 0.45, "friction");
  within(ropes, 1, 6, "ropes");
  return { diameter, wrap, friction, ropes };
}

/**
 * The greatest ratio of tensions friction will hold.
 *
 * The capstan equation, which is the oldest piece of arithmetic on a
 * ship and turns up here unchanged. Half a wrap at a friction of a
 * quarter gives 2.19, and that is the whole budget: the taut side may
 * pull 2.19 times what the slack side does and no more, whatever else
 * is true of the installation.
 */
export function mostRatio(one: Koepe): number {
  return round(Math.exp((one.friction * one.wrap * Math.PI) / 180), 4);
}

/** The margin the rules want kept below that ratio. */
export const SLIP_MARGIN = 1.25;

/** The ratio a winder may actually be worked at. */
export function workingRatio(one: Koepe, margin = SLIP_MARGIN): number {
  positive(margin, "margin");
  insist(margin >= 1, "a margin below one is not a margin", "margin");
  return round(mostRatio(one) / margin, 4);
}

/**
 * The ratio the two sides are actually at.
 *
 * Everything hanging on the taut side over everything on the slack
 * side, counting the rope.
 *
 * The rope makes it worse and not better, which is the opposite of what
 * one expects and is worth being clear about. Rope on the slack side
 * would indeed help — but the worst moment of the wind is the one where
 * the slack side has no rope beneath the wheel at all, because its
 * conveyance is at the top and all the rope is on the other side. So
 * depth hurts a friction winder, and it hurts it in direct proportion.
 * The balance rope is what answers it, and a friction winder without
 * one is a shallow-shaft machine.
 */
export function ratioAt(taut: number, slack: number): number {
  positive(taut, "taut");
  positive(slack, "slack");
  return round(taut / slack, 4);
}

/**
 * Whether the rope will drive without slipping.
 *
 * The question the whole machine turns on. Slip on a friction winder is
 * not a nuisance: it burns the lining flat in one wind and the winder
 * has to be stopped.
 */
export function willDrive(one: Koepe, taut: number, slack: number, margin = SLIP_MARGIN): boolean {
  return ratioAt(taut, slack) <= workingRatio(one, margin);
}

/**
 * The tension on each side, in kilonewtons, counting the rope.
 *
 * Given what hangs on each conveyance and how much rope is beneath the
 * wheel on each side. The two lengths add to twice the depth on a
 * cage winder — one side is nearly all paid out when the other is
 * nearly all wound in — so the ratio is worst at the ends of the wind
 * and best in the middle.
 */
export function tensions(
  rope: Rope,
  depth: number,
  risingLoad: number,
  fallingLoad: number,
  at: number,
  ropes = 1,
  balance = 0,
): { readonly taut: number; readonly slack: number } {
  positive(depth, "depth");
  within(at, 0, depth, "at");
  positive(risingLoad, "risingLoad");
  positive(fallingLoad, "fallingLoad");
  positive(ropes, "ropes");
  nonNegative(balance, "balance");
  // `at` is how far the rising conveyance still has to go, so it has
  // that much winding rope beneath the wheel — and the balance rope
  // hung beneath it is the mirror image, so it has the rest of that.
  const winding = weightOf(massPerMetre(rope) * ropes);
  const hanging = weightOf(balance);
  const rising = risingLoad + winding * at + hanging * (depth - at);
  const falling = fallingLoad + winding * (depth - at) + hanging * at;
  return rising >= falling
    ? { taut: round(rising, 4), slack: round(falling, 4) }
    : { taut: round(falling, 4), slack: round(rising, 4) };
}

/**
 * The worst ratio anywhere in the wind.
 *
 * Walked, because the worst point is not always at an end: with a
 * balance rope it is in the middle, and with an unusually heavy
 * conveyance it can be anywhere. Walking it is cheap and guessing has
 * burnt linings.
 */
export function worstRatio(
  rope: Rope,
  depth: number,
  risingLoad: number,
  fallingLoad: number,
  steps = 100,
  ropes = 1,
  balance = 0,
): number {
  positive(steps, "steps");
  let worst = 0;
  for (let at = 0; at <= steps; at += 1) {
    const found = tensions(rope, depth, risingLoad, fallingLoad, (depth * at) / steps, ropes, balance);
    const ratio = ratioAt(found.taut, found.slack);
    if (ratio > worst) worst = ratio;
  }
  return round(worst, 4);
}

/**
 * The balance rope: a rope hung beneath the two conveyances and looped
 * in the sump.
 *
 * It does two things and the second is the reason it exists. It makes
 * the out-of-balance the same at every point of the wind, so the winder
 * sees a constant load — and it puts weight on the slack side exactly
 * when the slack side is short of it, which brings the tension ratio
 * down and lets a friction winder be used at all.
 *
 * The right weight is the same as the winding rope's, and then the two
 * cancel exactly.
 */
export function balanceRopeFor(rope: Rope, ropes = 1): number {
  positive(ropes, "ropes");
  return round(massPerMetre(rope) * ropes, 4);
}

/** The tensions with a balance rope hung, which do not move through the wind. */
export function balancedTensions(
  rope: Rope,
  depth: number,
  risingLoad: number,
  fallingLoad: number,
  ropes = 1,
): { readonly taut: number; readonly slack: number } {
  // A matched balance rope makes the position irrelevant, so any point
  // of the wind gives the same answer and the middle is as good as any.
  return tensions(rope, depth, risingLoad, fallingLoad, depth / 2, ropes, massPerMetre(rope) * ropes);
}

/**
 * The deepest shaft a friction winder will hold without a balance rope,
 * in metres.
 *
 * Nought if it will not hold at any depth, which is the ordinary answer
 * for skips: a loaded skip is three and a half times an empty one
 * before any rope is counted, and no lining holds that. It is the
 * calculation that says, in one number, that a skip friction winder
 * must have a balance rope — not should, must.
 */
export function deepestDriving(one: Koepe, rope: Rope, risingLoad: number, fallingLoad: number, margin = SLIP_MARGIN): number {
  const allowed = workingRatio(one, margin);
  let best = 0;
  for (let at = 0; at <= 3000; at += 10) {
    if (worstRatio(rope, Math.max(1, at), risingLoad, fallingLoad) <= allowed) best = at;
  }
  return best;
}

/**
 * The hanging rope a wind needs to bring the ratio inside the margin,
 * in kilograms a metre.
 *
 * The winding rope and the balance rope together, because it is their
 * sum that hangs beneath the wheel at every point of the wind. On a
 * cage winder the answer is usually less than the winding rope alone
 * and the balance rope is a formality; on a skip winder it is two or
 * three times it, which is why a skip installation's balance rope is a
 * heavier rope than the ones doing the winding and looks, to anybody
 * seeing it for the first time, as though it has been fitted the wrong
 * way round.
 */
export function hangingNeeded(
  one: Koepe,
  depth: number,
  risingLoad: number,
  fallingLoad: number,
  margin = SLIP_MARGIN,
): number {
  positive(depth, "depth");
  positive(risingLoad, "risingLoad");
  positive(fallingLoad, "fallingLoad");
  const allowed = workingRatio(one, margin);
  insist(allowed > 1, "no lining holds a ratio of one", "friction");
  insist(risingLoad > fallingLoad, "that wind is already balanced", "risingLoad");
  // (rising + x) / (falling + x) = allowed, solved for the weight x.
  const wanted = (risingLoad - allowed * fallingLoad) / (allowed - 1);
  if (wanted <= 0) return 0;
  return round((wanted * 1000) / 9.80665 / depth, 4);
}

/**
 * How much wrap would answer instead, in degrees.
 *
 * The other lever, and the cheaper one where there is room for a
 * deflection sheave under the wheel. Two hundred and ten degrees buys
 * as much as a fifth more friction does, and a lining's friction is not
 * something anybody should be relying on to the second place.
 */
export function wrapNeeded(one: Koepe, taut: number, slack: number, margin = SLIP_MARGIN): number {
  positive(taut, "taut");
  positive(slack, "slack");
  positive(margin, "margin");
  const ratio = ratioAt(taut, slack) * margin;
  insist(ratio > 1, "that wind needs no wrap at all", "taut");
  const wanted = (Math.log(ratio) / one.friction) * (180 / Math.PI);
  return round(wanted, 1);
}

/**
 * How much load each rope of a multi-rope winder carries, in
 * kilonewtons.
 *
 * Never quite an equal share. Four ropes over one wheel are never
 * exactly the same length, and the short one takes more than its share
 * until it stretches — so the design allowance is that one rope carries
 * a tenth more than the mean, and the rope size follows from that
 * rather than from the mean.
 */
export const ROPE_SHARE_ERROR = 0.1;

/** The load the worst-off rope of a set carries. */
export function worstRope(one: Koepe, whole: number, error = ROPE_SHARE_ERROR): number {
  positive(whole, "whole");
  share(error, "error");
  insist(one.ropes >= 1, "a winder has at least one rope", "ropes");
  return round((whole / one.ropes) * (1 + error), 4);
}

/** The least wheel a rope may run over on a friction winder, in metres. */
export function leastWheel(rope: Rope): number {
  // A friction winder bends its rope once a wind rather than twice, so
  // it is allowed a slightly smaller wheel than a drum — but only a
  // little, because the rope is also being squeezed into a lining.
  return round(leastDrum(rope) * 0.95, 3);
}

/** Whether the wheel is large enough for the rope on it. */
export function wheelBigEnough(one: Koepe, rope: Rope): boolean {
  return one.diameter >= leastWheel(rope);
}

/**
 * The pressure the rope puts on the lining, in newtons a square
 * millimetre.
 *
 * What wears the lining out and what limits how much load one wheel can
 * take. Two newtons a square millimetre is what a lining will stand
 * continuously, and it is the reason a friction winder has four ropes
 * rather than one.
 */
export function liningPressure(one: Koepe, rope: Rope, taut: number, slack: number): number {
  nonNegative(taut, "taut");
  nonNegative(slack, "slack");
  const perRope = (taut + slack) / one.ropes;
  const contact = (one.diameter / 2) * rope.diameter;
  insist(contact > 0, "that wheel has no groove", "diameter");
  return round((perRope * 1000) / (contact * 1000), 4);
}

/** What a lining will stand continuously. */
export const MOST_PRESSURE = 2;

/** Whether the lining will stand it. */
export function liningStands(one: Koepe, rope: Rope, taut: number, slack: number, most = MOST_PRESSURE): boolean {
  positive(most, "most");
  return liningPressure(one, rope, taut, slack) <= most;
}

/** The friction winder in a line. */
export function describeKoepe(one: Koepe): string {
  return (
    `a ${one.diameter} m wheel with ${one.ropes} ropes, ` +
    `${one.wrap}° of wrap at µ ${one.friction}: ` +
    `${mostRatio(one)} to one, worked at ${workingRatio(one)}`
  );
}
