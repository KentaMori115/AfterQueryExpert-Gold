/**
 * The drum, which has to coil a mile of rope and give it back straight.
 *
 * A cylindrical drum winds by coiling the rope onto itself. That sounds
 * simple and is not: the rope has to lie in a helix that advances one
 * rope diameter a turn, the sheave it comes off is fixed while the coil
 * moves along the drum, so the rope runs at an angle that changes
 * through the wind, and if that angle gets past about a degree and a
 * half the rope climbs over its neighbour and comes down again with a
 * bang that can be heard at the surface.
 *
 * Deep shafts want more rope than one layer will hold, and a second
 * layer is worse in every way: it crushes the first, it wears at the
 * cross-over, and it changes the effective radius so the speed changes
 * without the engine doing anything.
 */

import { WindingError, count, insist, nonNegative, positive, within } from "../errors.ts";
import { round, roundUp } from "../units/round.ts";
import { type Rope, leastDrum } from "../rope/index.ts";

/** A cylindrical winding drum, as built. */
export interface Drum {
  /** The barrel diameter, in metres. */
  readonly diameter: number;
  /** The barrel width, in metres. */
  readonly width: number;
  /** How many layers of rope it is meant to carry. */
  readonly layers: number;
  /** The distance from the drum to the headgear sheave, in metres. */
  readonly lead: number;
}

/** A drum, checked. */
export function drum(diameter = 4.2, width = 2.4, layers = 2, lead = 46): Drum {
  within(diameter, 1, 12, "diameter");
  positive(width, "width");
  count(layers, "layers");
  within(layers, 1, 4, "layers");
  positive(lead, "lead");
  return { diameter, width, layers, lead };
}

/**
 * The pitch a rope is coiled at, in millimetres.
 *
 * A little more than the rope diameter, because a rope laid tight
 * against its neighbour rubs against it. The groove is cut to suit and
 * the pitch follows the groove.
 */
export const PITCH_OVER_DIAMETER = 1.05;

/** How many turns one layer holds. */
export function turnsALayer(one: Drum, rope: Rope): number {
  const pitch = (rope.diameter * PITCH_OVER_DIAMETER) / 1000;
  insist(pitch > 0, "that rope has no diameter", "rope");
  return Math.floor(one.width / pitch);
}

/**
 * The mean diameter of a stated layer, in metres.
 *
 * The barrel plus two rope diameters for every layer already on. It is
 * why a multi-layer drum does not wind at a constant speed: the rope
 * comes off the second layer faster than the first for the same drum
 * speed, and the winder has to be driven to allow for it.
 */
export function layerDiameter(one: Drum, rope: Rope, layer = 1): number {
  count(layer, "layer");
  insist(layer >= 1, "layers are counted from one", "layer");
  return round(one.diameter + ((layer - 1) * 2 * rope.diameter) / 1000, 4);
}

/** How much rope one layer holds, in metres. */
export function ropeInLayer(one: Drum, rope: Rope, layer = 1): number {
  return round(turnsALayer(one, rope) * Math.PI * layerDiameter(one, rope, layer), 2);
}

/** How much rope the whole drum holds, in metres. */
export function capacity(one: Drum, rope: Rope): number {
  let found = 0;
  for (let at = 1; at <= one.layers; at += 1) found += ropeInLayer(one, rope, at);
  return round(found, 2);
}

/** How many layers a stated length of rope will make. */
export function layersFor(one: Drum, rope: Rope, metres: number): number {
  positive(metres, "metres");
  let left = metres;
  let at = 0;
  while (left > 0 && at < 12) {
    at += 1;
    left -= ropeInLayer(one, rope, at);
  }
  insist(left <= 0, "that drum will not hold that rope in twelve layers", "metres");
  return at;
}

/** Whether the drum holds the rope in the layers it was built for. */
export function holdsIt(one: Drum, rope: Rope, metres: number): boolean {
  return capacity(one, rope) >= metres;
}

/**
 * The fleet angle: how far the rope leans as it runs onto the drum, in
 * degrees.
 *
 * Measured at the worst point, which is the end of the barrel. Past
 * about a degree and a half the rope will not lie down: it rides up on
 * the turn beside it and then drops, and the drop is what breaks wires.
 * The cure is a longer lead, which is why a headgear stands where it
 * does and not closer.
 */
export function fleetAngle(one: Drum): number {
  const half = one.width / 2;
  insist(one.lead > 0, "the sheave is at the drum", "lead");
  return round((Math.atan(half / one.lead) * 180) / Math.PI, 3);
}

/** The fleet angle past which a rope will not lie down. */
export const MOST_FLEET = 1.5;

/** Whether the rope will lie down on that drum from that distance. */
export function liesDown(one: Drum, most = MOST_FLEET): boolean {
  positive(most, "most");
  return fleetAngle(one) <= most;
}

/** The lead a stated drum needs to keep the fleet angle down, in metres. */
export function leadFor(one: Drum, most = MOST_FLEET): number {
  positive(most, "most");
  return roundUp(one.width / 2 / Math.tan((most * Math.PI) / 180), 1);
}

/** Whether the drum is big enough for the rope it carries. */
export function bigEnoughFor(one: Drum, rope: Rope): boolean {
  return one.diameter >= leastDrum(rope);
}

/** The drum diameter a rope asks for, in metres, rounded up to a tenth. */
export function diameterFor(rope: Rope): number {
  return roundUp(leastDrum(rope), 1);
}

/**
 * The crushing a second layer puts on the first, as a share of the rope
 * tension.
 *
 * Every turn of the upper layer presses down on the one below through
 * the angle it wraps. It builds up: the bottom of a four-layer coil
 * carries several times the tension it was wound on at, and the rope is
 * flattened where nobody can see it. It is the reason a multi-layer
 * drum is a compromise rather than a design.
 */
export function crushing(one: Drum, layers = one.layers): number {
  count(layers, "layers");
  insist(layers >= 1, "there is always at least one layer", "layers");
  // Each layer above adds about two thirds of its own tension to the
  // one below, and the effect compounds down the coil.
  let found = 1;
  for (let at = 1; at < layers; at += 1) found = found * 1 + 0.66;
  return round(found, 3);
}

/** The turns of rope that must stay on the drum when it is fully paid out. */
export const DEAD_TURNS = 3;

/** The rope that never comes off, in metres. */
export function deadRope(one: Drum, rope: Rope, turns = DEAD_TURNS): number {
  count(turns, "turns");
  return round(turns * Math.PI * one.diameter, 2);
}

/**
 * The revolutions a wind takes.
 *
 * On one layer it is simply the rope length over the circumference. On
 * more than one it is not, because the later layers pay out more rope a
 * turn — so a multi-layer drum's wind is shorter in revolutions than
 * the single-layer arithmetic says, and a winder driven to a
 * revolution count rather than a rope length will overwind.
 */
export function turnsFor(one: Drum, rope: Rope, metres: number): number {
  positive(metres, "metres");
  let left = metres;
  let turns = 0;
  for (let layer = 1; layer <= 12 && left > 0; layer += 1) {
    const inLayer = ropeInLayer(one, rope, layer);
    const perTurn = Math.PI * layerDiameter(one, rope, layer);
    if (left >= inLayer) {
      turns += turnsALayer(one, rope);
      left -= inLayer;
    } else {
      turns += left / perTurn;
      left = 0;
    }
  }
  insist(left <= 0, "that drum will not pay out that much rope", "metres");
  return round(turns, 2);
}

/** The drum speed a rope speed asks for on a stated layer, in revolutions a minute. */
export function revolutions(one: Drum, rope: Rope, speed: number, layer = 1): number {
  nonNegative(speed, "speed");
  const circumference = Math.PI * layerDiameter(one, rope, layer);
  insist(circumference > 0, "that drum has no circumference", "diameter");
  return round((speed * 60) / circumference, 2);
}

/** The rope speed a stated drum speed gives on a stated layer. */
export function ropeSpeed(one: Drum, rope: Rope, revolutionsAMinute: number, layer = 1): number {
  nonNegative(revolutionsAMinute, "revolutionsAMinute");
  return round((revolutionsAMinute / 60) * Math.PI * layerDiameter(one, rope, layer), 4);
}

/** How much the rope speed changes between the first layer and the last, as a share. */
export function speedCreep(one: Drum, rope: Rope): number {
  const first = layerDiameter(one, rope, 1);
  const last = layerDiameter(one, rope, one.layers);
  insist(first > 0, "that drum has no diameter", "diameter");
  return round((last - first) / first, 4);
}

/** The drum described in a line. */
export function describeDrum(one: Drum, rope: Rope): string {
  return (
    `${one.diameter} m by ${one.width} m in ${one.layers} layer${one.layers === 1 ? "" : "s"}: ` +
    `${capacity(one, rope)} m of ${rope.diameter} mm rope, ` +
    `fleet angle ${fleetAngle(one)}°`
  );
}

/** The error this module throws, for a caller that wants to catch it. */
export function refuse(says: string, quantity: string): never {
  throw new WindingError(says, quantity);
}
