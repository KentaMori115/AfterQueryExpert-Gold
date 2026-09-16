/**
 * What a wind that stops suddenly puts into the rope.
 *
 * A winding rope is never broken by the load it was designed for. It is
 * broken by a load nobody designed for at all, and the commonest of
 * those is the ordinary emergency stop: the brake goes on, the drum
 * stops in a couple of seconds, and the conveyance a kilometre below it
 * has no idea anything has happened until the rope tells it.
 *
 * The arithmetic is the oldest in the subject and it is still the piece
 * most often left out. A load put on a spring all at once does twice
 * what the same load put on gently does. So a retardation applied to
 * the drum does not raise the tension by mass times retardation: it
 * raises it by that much and then the conveyance swings past by the
 * same amount again, and the rope sees the sum for as long as the first
 * half-swing lasts.
 *
 * The direction the conveyance was going decides which way that lands.
 * A rising conveyance stopped hard is pulled harder — the rope takes
 * the whole of it and the figures below say whether it stands. A
 * falling one stopped hard is pulled *less*, because the retardation is
 * upward and the rope is being unloaded, and if it is unloaded past
 * zero the rope goes slack. That is the dangerous one. A slack winding
 * rope is a rope with a conveyance falling free underneath it, and when
 * it comes taut again it does so at whatever speed the conveyance has
 * picked up in the meantime, against a spring that no longer has a
 * second and a half to take up the load. Every rope this library would
 * condemn on a factor of safety has been condemned on paper. The ones
 * that part in a shaft part on a snatch.
 */

import { insist, nonNegative, positive } from "../errors.ts";
import { round } from "../units/round.ts";
import { type Hang, bounceMass, springRate, staticPull } from "./dynamics.ts";
import { breakingLoad } from "./construction.ts";

/**
 * How much more a load put on all at once does than the same load put
 * on gently.
 *
 * Twice, and the two is not an allowance or a factor of ignorance. It
 * is what a spring does: the mass arrives at the new resting place with
 * the speed it picked up getting there and carries straight on past it
 * by as far again, so the worst the spring sees is double and the mean
 * it settles to is single.
 */
export const SUDDEN = 2;

/**
 * The steady part of what a retardation adds, in kilonewtons.
 *
 * Mass times retardation, on the mass that is actually swinging rather
 * than on everything hanging in the shaft. That distinction is the
 * whole of the difference between this and a first calculation: a third
 * of the winding rope is moving with the conveyance and the rest of it
 * is being held by the drum, so a rope's own weight counts once in the
 * static pull and a third of a time here.
 */
export function steadyRise(one: Hang, retardation: number): number {
  positive(retardation, "retardation");
  return round((bounceMass(one) * retardation) / 1000, 4);
}

/**
 * The most the rope carries when a rising wind is stopped, in
 * kilonewtons.
 *
 * What was already hanging, plus twice what the retardation adds. It is
 * reached about a quarter of a bounce after the brake goes on and it
 * does not last: half a period later the tension is back to the static
 * figure and the rope has forgotten about it. The rope has forgotten
 * about it; the wires have not.
 */
export function peakPull(one: Hang, retardation: number): number {
  return round(staticPull(one) + SUDDEN * steadyRise(one, retardation), 4);
}

/**
 * The least it carries when a falling wind is stopped, in kilonewtons.
 *
 * The same arithmetic the other way up, because retarding a descending
 * conveyance means holding it back, and the rope holds it back by
 * pulling less. Nought is not a floor: the figure goes negative on
 * paper and what a negative rope tension means in a shaft is that there
 * is no rope tension at all.
 */
export function leastPull(one: Hang, retardation: number): number {
  return round(staticPull(one) - SUDDEN * steadyRise(one, retardation), 4);
}

/** Whether stopping a descending wind that hard leaves the rope slack. */
export function goesSlack(one: Hang, retardation: number): boolean {
  return leastPull(one, retardation) <= 0;
}

/**
 * The hardest a descending wind may be stopped before the rope goes
 * slack, in metres a second squared.
 *
 * The retardation at which twice the steady rise eats the whole static
 * pull. It is a real limit on how hard a winder may be braked going
 * down and it is tightest exactly where nobody wants it to be: at the
 * top of a deep shaft, where a balance rope has put its whole weight
 * into the swinging mass and the winding rope has taken most of its own
 * weight out of the static pull.
 */
export function hardestDown(one: Hang): number {
  const mass = bounceMass(one);
  insist(mass > 0, "that hang has nothing to retard", "carried");
  return round((staticPull(one) * 1000) / (SUDDEN * mass), 4);
}

/**
 * What the rope sees when a slack rope comes taut, in kilonewtons.
 *
 * A free conveyance meeting a spring, which is a different problem from
 * a load on a spring and a very much worse one: the tension is the
 * speed times the root of the stiffness and the mass together, and it
 * takes no account whatever of what the thing weighs. It is why a
 * snatch is measured against the breaking load rather than against the
 * factor of safety — a factor of safety is about a load and this is
 * about an energy.
 */
export function snatchPull(one: Hang, speed: number): number {
  positive(speed, "speed");
  const stiffness = springRate(one) * 1000;
  const mass = bounceMass(one);
  insist(stiffness > 0 && mass > 0, "that hang has nothing to snatch", "carried");
  return round((speed * Math.sqrt(stiffness * mass)) / 1000, 3);
}

/**
 * The factor of safety the rope is working at while a rising wind is
 * stopped.
 *
 * The breaking load of the whole set over the peak pull. It is not the
 * factor the rules ask for, which is a static figure about a rope
 * hanging still, and it is always lower — the question a design asks of
 * it is whether it stays above the floor the rules will not go below
 * however deep the shaft is.
 */
export function shockFactor(one: Hang, retardation: number): number {
  const peak = peakPull(one, retardation);
  insist(peak > 0, "nothing is hanging on that rope", "carried");
  return round((breakingLoad(one.rope) * one.ropes) / peak, 3);
}

/** Whether that factor stays above a stated floor. */
export function standsTheStop(one: Hang, retardation: number, wanted: number): boolean {
  positive(wanted, "wanted");
  return shockFactor(one, retardation) >= wanted;
}

/**
 * The hardest a rising wind may be stopped and still keep a stated
 * factor, in metres a second squared.
 *
 * Solved rather than searched, because the peak pull is a straight line
 * in the retardation. Nought comes back where the rope will not keep
 * that factor standing still, which is a fact about the rope and the
 * shaft and not about the brake, and no brake setting whatever will
 * mend it.
 */
export function hardestUp(one: Hang, wanted: number): number {
  positive(wanted, "wanted");
  const allowed = (breakingLoad(one.rope) * one.ropes) / wanted;
  const spare = allowed - staticPull(one);
  if (spare <= 0) return 0;
  const mass = bounceMass(one);
  insist(mass > 0, "that hang has nothing to retard", "carried");
  return round((spare * 1000) / (SUDDEN * mass), 4);
}

/**
 * How much of the rope's strength one stop uses up, as a share.
 *
 * The peak pull over the breaking load. It is the figure to quote at
 * somebody who says an emergency stop is free: it is not free, it is a
 * cycle of stress at a share of breaking that no ordinary wind comes
 * near, and a winder whose overspeed gear trips twice a shift is
 * spending rope on it.
 */
export function stopShare(one: Hang, retardation: number): number {
  const breaking = breakingLoad(one.rope) * one.ropes;
  insist(breaking > 0, "that rope stands nothing", "rope");
  return round(peakPull(one, retardation) / breaking, 4);
}

/** The stop described in a line. */
export function describeShock(one: Hang, retardation: number): string {
  return (
    `stopping at ${retardation} m/s² takes it to ${peakPull(one, retardation)} kN, ` +
    `a factor of ${shockFactor(one, retardation)}, ` +
    `${goesSlack(one, retardation) ? "and slack going down" : `and ${leastPull(one, retardation)} kN going down`}`
  );
}
