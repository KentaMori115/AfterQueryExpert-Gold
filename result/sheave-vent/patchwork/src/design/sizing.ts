/**
 * Sizing a winding installation, which cannot be done in one pass.
 *
 * The cycle decides the payload; the payload decides the conveyance;
 * the conveyance and the depth decide the rope; the rope decides the
 * drum; the conveyance decides the shaft. It reads like a loop and it
 * is not one: every arrow points forward and nothing at the end
 * reaches back to change anything at the beginning.
 *
 * That is worth being explicit about, because the feedback everybody
 * expects — a bigger rope weighs more, which wants a bigger rope — is
 * real and is not here. It lives one level down, inside the search in
 * `diameterForDuty`, which walks up the diameters with the rope's own
 * weight counted at every step and stops at the first that holds. By
 * the time a diameter comes back out of it the argument is over.
 *
 * What the cascade can do is fail, and some duties have no installation
 * at all: a calculation that returns a rope nobody makes rather than
 * saying so is worse than useless.
 */

import { WindingError, insist, count, positive, within } from "../errors.ts";
import { round, roundUp } from "../units/round.ts";
import { weightOf } from "../units/measure.ts";
import { type Rope, breakingLoad, constructionNamed, diameterForDuty, factorFor, leastDrum, massPerMetre, rope } from "../rope/index.ts";
import { type Conveyance, CAGE_TARE, SKIP_TARE, conveyance, skip } from "../cage/index.ts";
import { type Drum, drum, leadFor, ropeInLayer, turnsALayer } from "../drum/cylindrical.ts";
import { type Shaft, BETWEEN_CONVEYANCES, TO_GUIDES, TO_LINING, shaft } from "../shaft/index.ts";
import { type Profile, cycleTime, profile, tonnesAnHour, windsAnHour } from "../cycle/index.ts";

/**
 * The payload a wanted output asks for, in kilograms.
 *
 * From the winds an hour the cycle gives, which depends on the depth
 * and the profile and not at all on how much is in the conveyance. That
 * independence is what makes the loop settle: the payload follows from
 * the cycle in one step and everything else follows from the payload.
 */
export function payloadFor(wanted: number, depth: number, how: Profile): number {
  positive(wanted, "wanted");
  positive(depth, "depth");
  const winds = windsAnHour(how, depth);
  insist(winds > 0, "that cycle makes no winds at all", "depth");
  return roundUp((wanted * 1000) / winds, 0);
}

/** The conveyance a payload asks for, given what sort it is to be. */
export function conveyanceFor(payload: number, kind: "cage" | "skip"): Conveyance {
  positive(payload, "payload");
  if (kind === "skip") return skip(payload);
  return conveyance({
    name: "the cage",
    kind: "cage",
    tare: round(payload * CAGE_TARE, 0),
    payload,
    decks: 2,
    width: round(Math.max(2, Math.sqrt(payload / 1000) * 1.3), 2),
    across: round(Math.max(1.2, Math.sqrt(payload / 1000) * 0.75), 2),
  });
}

/** The rope a conveyance and a depth ask for. */
export function ropeFor(one: Conveyance, depth: number, grade = 1960): Rope {
  const hanging = weightOf(one.tare + one.payload);
  const diameter = diameterForDuty(depth, hanging, constructionNamed("6x36"), grade);
  return rope(diameter, constructionNamed("6x36"), grade);
}

/**
 * The drum a rope and a length of it ask for.
 *
 * The diameter follows from the rope, the width from how much rope has
 * to go on it in the layers allowed, and the lead from the width — and
 * the lead is what puts the headgear where it is, which is the one
 * decision here that shows up on a photograph.
 */
export function drumFor(one: Rope, metres: number, layers = 2): Drum {
  positive(metres, "metres");
  count(layers, "layers");
  const diameter = roundUp(leastDrum(one), 1);
  const perTurn = Math.PI * diameter;
  const turns = Math.ceil(metres / perTurn / layers);
  const pitch = (one.diameter * 1.05) / 1000;
  const width = roundUp(turns * pitch, 1);
  const trial = drum(diameter, width, layers, 40);
  return drum(diameter, width, layers, leadFor(trial));
}

/** The shaft a set of conveyances asks for. */
export function shaftFor(one: Conveyance, depth: number, conveyances = 2, guide = 0.1, name = "the shaft"): Shaft {
  count(conveyances, "conveyances");
  const gaps = Math.max(0, conveyances - 1) * BETWEEN_CONVEYANCES;
  const guides = conveyances * 2 * (guide + TO_GUIDES);
  const wanted = roundUp(conveyances * one.width + gaps + guides + 2 * TO_LINING, 1);
  return shaft(name, wanted, depth, conveyances, sumpFor(15), headgearFor(15));
}

/** The sump a stated winding speed asks for, in metres. */
export function sumpFor(speed: number, retardation = 9.81): number {
  positive(speed, "speed");
  positive(retardation, "retardation");
  return roundUp((speed * speed) / (2 * retardation) + 2, 0);
}

/** The headgear a stated winding speed asks for, in metres. */
export function headgearFor(speed: number, sheave = 6, plate = 4, retardation = 9.81): number {
  positive(speed, "speed");
  return roundUp((speed * speed) / (2 * retardation) + sheave + plate, 0);
}

/** A whole installation, sized for a duty. */
export interface Sized {
  /** What goes up. */
  readonly conveyance: Conveyance;
  /** What it hangs on. */
  readonly rope: Rope;
  /** What coils it. */
  readonly drum: Drum;
  /** What it works in. */
  readonly shaft: Shaft;
  /** How it is set to work. */
  readonly profile: Profile;
}

/**
 * Size a whole installation for a wanted output from a wanted depth.
 *
 * Take a payload from the cycle, build a conveyance round it, find the
 * rope that will hang it at the depth, find the drum for the rope, find
 * the shaft for the conveyance. Five steps in one direction.
 *
 * It refuses rather than approximates. If no rope this library knows
 * will hang that conveyance at that depth, the answer is that the duty
 * wants two lifts and not that the rope is ninety-one millimetres.
 */
export function sizeFor(
  wanted: number,
  depth: number,
  kind: "cage" | "skip" = "skip",
  how: Profile = profile(),
): Sized {
  positive(wanted, "wanted");
  positive(depth, "depth");
  const payload = payloadFor(wanted, depth, how);
  const one = conveyanceFor(payload, kind);
  const line = ropeFor(one, depth);
  const built = shaftFor(one, depth, 2, 0.1);
  const coiler = drumFor(line, depth + built.headgear);
  return { conveyance: one, rope: line, drum: coiler, shaft: built, profile: how };
}

/**
 * The deepest a stated output can be wound from in one lift, in metres.
 *
 * Searched, because it is not a formula: deeper wants a bigger rope,
 * whose weight wants a bigger rope again, and somewhere the two stop
 * converging. That depth is a real limit on a single-lift shaft and it
 * is why the deepest mines wind in stages.
 */
export function deepestFor(wanted: number, kind: "cage" | "skip" = "skip", how: Profile = profile()): number {
  let best = 0;
  for (let at = 200; at <= 3000; at += 50) {
    try {
      sizeFor(wanted, at, kind, how);
      best = at;
    } catch {
      return best;
    }
  }
  return best;
}

/** What that installation will actually raise, in tonnes an hour. */
export function raises(one: Sized): number {
  return tonnesAnHour(one.profile, one.shaft.depth, one.conveyance.payload);
}

/** Whether the drum will hold the rope the shaft wants. */
export function drumHolds(one: Sized): boolean {
  let held = 0;
  for (let at = 1; at <= one.drum.layers; at += 1) held += ropeInLayer(one.drum, one.rope, at);
  return held >= one.shaft.depth + one.shaft.headgear;
}

/** The turns of rope on one layer of the drum it was given. */
export function turnsOnIt(one: Sized): number {
  return turnsALayer(one.drum, one.rope);
}

/** What the rope alone weighs, in tonnes. */
export function ropeTonnes(one: Sized): number {
  return round((massPerMetre(one.rope) * (one.shaft.depth + one.shaft.headgear)) / 1000, 3);
}

/** The factor of safety the sized rope works at. */
export function factorGiven(one: Sized): number {
  const hanging = weightOf(one.conveyance.tare + one.conveyance.payload);
  const own = weightOf(massPerMetre(one.rope) * one.shaft.depth);
  insist(hanging + own > 0, "that installation hangs nothing", "conveyance");
  return round(breakingLoad(one.rope) / (hanging + own), 3);
}

/** And the one the depth demands. */
export function factorDemanded(one: Sized): number {
  return factorFor(one.shaft.depth);
}

/** The tare a conveyance of that sort would have, as a share of the payload. */
export function tareShare(kind: "cage" | "skip"): number {
  return kind === "skip" ? SKIP_TARE : CAGE_TARE;
}

/** The whole thing described in a line. */
export function describeSized(one: Sized): string {
  return (
    `${round(one.conveyance.payload / 1000, 2)} t ${one.conveyance.kind} on a ${one.rope.diameter} mm rope, ` +
    `a ${one.drum.diameter} by ${one.drum.width} m drum and a ${one.shaft.diameter} m shaft: ` +
    `${raises(one)} t/h from ${one.shaft.depth} m`
  );
}

/** The cycle time the sized installation works to, in seconds. */
export function cycleOf(one: Sized): number {
  return cycleTime(one.profile, one.shaft.depth);
}

/** The error this module throws, for a caller that wants to catch it. */
export function refuse(says: string, quantity: string): never {
  throw new WindingError(says, quantity);
}

/** How wide a shaft a stated conveyance and count want, in metres. */
export function shaftWidthFor(width: number, conveyances = 2, guide = 0.1): number {
  positive(width, "width");
  count(conveyances, "conveyances");
  within(guide, 0, 1, "guide");
  const gaps = Math.max(0, conveyances - 1) * BETWEEN_CONVEYANCES;
  const guides = conveyances * 2 * (guide + TO_GUIDES);
  return round(conveyances * width + gaps + guides + 2 * TO_LINING, 3);
}
