/**
 * The guides, which keep a conveyance from doing what a pendulum on a
 * kilometre of rope would otherwise do.
 *
 * A cage hanging on a rope is a pendulum with a very long period and
 * almost no damping. Left to itself it swings, and at thirty miles an
 * hour in a shaft with a hand's breadth of clearance it does not swing
 * for long. So it runs between guides: either rigid ones — timber or
 * steel bolted to the lining every few metres — or rope ones, which are
 * ropes hung down the shaft and tensioned by weights at the bottom.
 *
 * The two behave quite differently, and the difference is not a matter
 * of preference. A rigid guide is a beam and its stiffness comes from
 * its section; a rope guide is a taut string and its stiffness comes
 * entirely from its tension, so a colliery that wants stiffer rope
 * guides has to hang more weight in the sump and not a thicker rope.
 *
 * The thing to be careful about is the span. A taut string's transverse
 * stiffness is four times its tension over the span between whatever is
 * holding it — and the span here is the conveyance's own shoes, a few
 * metres apart, not the whole depth of the shaft. Using the shaft depth
 * is the classic error and it gives a sway of several metres, which
 * would be visible from the surface.
 */

import { insist, count, nonNegative, positive, within } from "../errors.ts";
import { round, roundUp } from "../units/round.ts";
import { weightOf } from "../units/measure.ts";
import { type Rope, breakingLoad, massPerMetre } from "../rope/index.ts";

/** What sort of guides a shaft has. */
export type Guiding = "rigid" | "rope";

/** A set of guides, as fitted. */
export interface Guides {
  /** Which sort they are. */
  readonly sort: Guiding;
  /** How many run beside each conveyance. */
  readonly number: number;
  /** For rigid guides, the distance between the buntons, in metres. */
  readonly spacing: number;
  /** For rope guides, the weight hung on each, in kilonewtons. */
  readonly tension: number;
}

/** Guides, checked. */
export function guides(sort: Guiding = "rope", number = 4, spacing = 6, tension = 90): Guides {
  count(number, "number");
  within(number, 2, 8, "number");
  positive(spacing, "spacing");
  nonNegative(tension, "tension");
  insist(sort !== "rope" || tension > 0, "a rope guide with no tension on it is a rope lying in the sump", "tension");
  return { sort, number, spacing, tension };
}

/**
 * The lateral load a conveyance puts on its guides, in kilonewtons.
 *
 * A share of its weight, because a conveyance is never loaded evenly
 * and never runs quite square. A fiftieth is the ordinary steady
 * allowance and a tenth is the shock a badly loaded skip gives on
 * starting, which is why the loading arrangements at the pit bottom are
 * a guide question as much as a filling one.
 */
export const OUT_OF_SQUARE = 0.02;

/** The lateral load a conveyance of a stated weight makes. */
export function lateralLoad(kilograms: number, share = OUT_OF_SQUARE): number {
  positive(kilograms, "kilograms");
  within(share, 0, 0.3, "share");
  return round(weightOf(kilograms) * share, 4);
}

/**
 * The stiffness one rope guide gives, in kilonewtons a metre.
 *
 * Four times the tension over the span between the conveyance's shoes —
 * nothing to do with the steel in the rope at all. That is the
 * surprising part and it is the whole design: to stiffen a rope guide,
 * hang more weight on it; making it a thicker rope does almost nothing
 * except make it heavier to tension.
 *
 * The span is the conveyance's shoes and not the shaft. A conveyance
 * five metres tall holds each guide rope at two points five metres
 * apart, and it is that five metres the string formula wants. Put the
 * shaft depth in instead and the answer comes out two hundred times too
 * soft.
 */
export function ropeStiffness(one: Guides, shoeSpan: number): number {
  insist(one.sort === "rope", "a rigid guide has no tension to be stiff with", "sort");
  positive(shoeSpan, "shoeSpan");
  return round((4 * one.tension) / shoeSpan, 5);
}

/**
 * How far a conveyance moves sideways against its guides, in metres.
 *
 * The span is the conveyance's shoe spacing for a rope guide and the
 * bunton spacing for a rigid one, which is why the same argument gets
 * quite different numbers on the two: a rigid guide deflects a
 * millimetre and a rope guide thirty, and a rope-guided shaft is built
 * with the clearances to suit.
 */
export function sway(one: Guides, span: number, lateral: number): number {
  positive(lateral, "lateral");
  positive(span, "span");
  if (one.sort === "rigid") {
    // A rigid guide deflects between its buntons like a beam on two
    // supports; the load is shared between the guides on each side.
    const perGuide = lateral / one.number;
    // The load is in kilonewtons and the modulus in kilonewtons a
    // square metre, so the answer is already in metres.
    return round((perGuide * one.spacing ** 3) / (48 * YOUNGS * SECOND_MOMENT), 6);
  }
  const stiffness = ropeStiffness(one, span) * one.number;
  insist(stiffness > 0, "those guides have no stiffness at all", "tension");
  return round(lateral / stiffness, 5);
}

/** The modulus of the steel a rigid guide is made of, in kN a square metre. */
export const YOUNGS = 200_000_000;

/** The second moment of an ordinary guide section, in metres to the fourth. */
export const SECOND_MOMENT = 4e-5;

/** How much sway the clearances allow before something is struck. */
export const MOST_SWAY = 0.05;

/** Whether the conveyance stays inside its clearances. */
export function staysClear(one: Guides, length: number, lateral: number, most = MOST_SWAY): boolean {
  positive(most, "most");
  return sway(one, length, lateral) <= most;
}

/** The tension a rope guide wants to keep the sway inside, in kilonewtons. */
export function tensionFor(shoeSpan: number, lateral: number, number = 4, most = MOST_SWAY): number {
  positive(shoeSpan, "shoeSpan");
  positive(lateral, "lateral");
  count(number, "number");
  positive(most, "most");
  return roundUp((lateral * shoeSpan) / (4 * number * most), 0);
}

/**
 * The natural period of the conveyance swinging on its rope, in
 * seconds.
 *
 * A simple pendulum of the length of rope paid out, which at nine
 * hundred metres is a minute — far slower than anything the winder
 * does, so the conveyance never gets round a full swing during a wind.
 * That is why an unguided shaft is possible at all in a sinking, and
 * why it stops being possible as soon as anything is wound quickly.
 */
export function swingPeriod(length: number): number {
  positive(length, "length");
  return round(2 * Math.PI * Math.sqrt(length / 9.80665), 2);
}

/**
 * The tension in a guide rope at a stated height above the sump, in
 * kilonewtons.
 *
 * A guide rope hangs vertically, so there is no catenary and no sag —
 * only a tension that is the hanging weight at the bottom and that
 * weight plus the rope above it everywhere else. The consequence is the
 * useful part: a rope guide is stiffest at the top of the shaft and
 * softest at the bottom, and a conveyance being landed at the pit
 * bottom is being guided by the least tension anywhere in the shaft.
 */
export function tensionAt(rope: Rope, one: Guides, above: number): number {
  insist(one.sort === "rope", "a rigid guide has no tension", "sort");
  nonNegative(above, "above");
  return round(one.tension + weightOf(massPerMetre(rope) * above), 4);
}

/** How much stiffer the guiding is at the top of the shaft than the bottom. */
export function stiffnessRange(rope: Rope, one: Guides, depth: number): number {
  const bottom = one.tension;
  insist(bottom > 0, "those guides have no tension at the bottom", "tension");
  return round(tensionAt(rope, one, depth) / bottom, 4);
}

/** The factor of safety a guide rope works at. */
export function guideFactor(rope: Rope, length: number, tension: number): number {
  positive(tension, "tension");
  const load = tension + weightOf(massPerMetre(rope) * length);
  insist(load > 0, "that guide carries nothing", "tension");
  return round(breakingLoad(rope) / load, 3);
}

/** The factor a guide rope is required to work at, which is lower than a winding rope's. */
export const GUIDE_FACTOR = 5;

/** Whether a guide rope is strong enough. */
export function guideStrongEnough(rope: Rope, length: number, tension: number, wanted = GUIDE_FACTOR): boolean {
  positive(wanted, "wanted");
  return guideFactor(rope, length, tension) >= wanted;
}

/**
 * How many buntons a rigid-guided shaft wants.
 *
 * One set every few metres for the whole depth, each of them a steel
 * girder across the shaft and each of them an obstruction to the
 * ventilation. A nine hundred metre shaft on six metre spacing has a
 * hundred and fifty sets in it, and their drag is a measurable share of
 * the fan's duty — which is the argument for rope guides put as a
 * number rather than as a preference.
 */
export function buntons(one: Guides, depth: number): number {
  insist(one.sort === "rigid", "a rope-guided shaft has no buntons", "sort");
  positive(depth, "depth");
  return Math.ceil(depth / one.spacing);
}

/** What those buntons cost the ventilation, as a share of the shaft's resistance. */
export function buntonDrag(one: Guides, depth: number, diameter: number): number {
  positive(diameter, "diameter");
  const how = buntons(one, depth);
  // Each set blocks about a twentieth of the section and the losses add.
  return round(Math.min(0.9, (how * 0.05 * 4) / (depth / diameter)), 4);
}

/** How far apart a conveyance's guide shoes are, in metres. */
export const SHOE_SPAN = 5;

/** The guides described in a line. */
export function describeGuides(one: Guides, length: number): string {
  return one.sort === "rope"
    ? `${one.number} rope guides at ${one.tension} kN, ${ropeStiffness(one, SHOE_SPAN)} kN/m of stiffness each`
    : `${one.number} rigid guides on ${one.spacing} m buntons, ${buntons(one, length)} sets in the shaft`;
}
