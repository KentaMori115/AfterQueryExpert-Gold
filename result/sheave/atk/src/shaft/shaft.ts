/**
 * The shaft, which is a hole with a great deal of arithmetic in it.
 *
 * A winding shaft is not simply deep. It has to hold two conveyances
 * passing each other at thirty miles an hour with a hand's breadth
 * between them, the guides that keep them apart, the ventilation air
 * that has to get past both, the pipes and cables that go down the
 * side, and a sump at the bottom deep enough that an overwind at the
 * pit bottom does not put the cage into water.
 *
 * Every one of those wants room and the shaft was sunk once. So the
 * arithmetic here is nearly all about what will fit, and the answer is
 * usually that the last thing anybody thought of will not.
 */

import { WindingError, count, insist, nonNegative, positive, within } from "../errors.ts";
import { round, roundUp } from "../units/round.ts";
import { depth as checkDepth } from "../errors.ts";

/** A shaft, as sunk. */
export interface Shaft {
  /** What it is called. */
  readonly name: string;
  /** The finished diameter inside the lining, in metres. */
  readonly diameter: number;
  /** From the bank to the lowest inset, in metres. */
  readonly depth: number;
  /** How many conveyances work in it. */
  readonly conveyances: number;
  /** The sump below the lowest inset, in metres. */
  readonly sump: number;
  /** The headgear sheave height above the bank, in metres. */
  readonly headgear: number;
}

/** A shaft, checked. */
export function shaft(
  name: string,
  diameter = 7.3,
  depth = 900,
  conveyances = 2,
  sump = 15,
  headgear = 42,
): Shaft {
  insist(name.trim().length > 0, "a shaft has to be called something", "name");
  within(diameter, 2, 12, "diameter");
  checkDepth(depth, "depth");
  count(conveyances, "conveyances");
  within(conveyances, 1, 4, "conveyances");
  positive(sump, "sump");
  within(headgear, 10, 90, "headgear");
  return { name: name.trim(), diameter, depth, conveyances, sump, headgear };
}

/** The cross-section inside the lining, in square metres. */
export function area(one: Shaft): number {
  return round((Math.PI * one.diameter * one.diameter) / 4, 3);
}

/** The whole length of rope a wind pays out, in metres. */
export function ropeLength(one: Shaft): number {
  return round(one.depth + one.headgear, 2);
}

/** The clearance the rules want between two passing conveyances, in metres. */
export const BETWEEN_CONVEYANCES = 0.15;

/** And between a conveyance and the lining. */
export const TO_LINING = 0.3;

/** And between a conveyance and its own guides. */
export const TO_GUIDES = 0.05;

/**
 * The width two conveyances of a stated size need across the shaft, in
 * metres.
 *
 * Two conveyances, the gap between them, the gap from each to the
 * lining, and the guides on both sides of both. It is a sum of small
 * numbers that comes to rather more than anybody expects, which is why
 * a shaft sunk for two four-tonne cages will not take two six-tonne
 * ones however the arithmetic of the winder works out.
 */
export function widthWanted(width: number, conveyances = 2, guide = 0.1): number {
  positive(width, "width");
  count(conveyances, "conveyances");
  positive(guide, "guide");
  const gaps = Math.max(0, conveyances - 1) * BETWEEN_CONVEYANCES;
  const guides = conveyances * 2 * (guide + TO_GUIDES);
  return round(conveyances * width + gaps + guides + 2 * TO_LINING, 3);
}

/** Whether conveyances of a stated width will go down that shaft. */
export function willFit(one: Shaft, width: number, guide = 0.1): boolean {
  return widthWanted(width, one.conveyances, guide) <= one.diameter;
}

/**
 * The widest conveyance a shaft will take, in metres.
 *
 * The inverse of the above, and the number a colliery contemplating
 * bigger cages actually asks. Rounded down to the centimetre, because
 * rounding up would specify a cage that does not go in.
 */
export function widestConveyance(one: Shaft, guide = 0.1): number {
  const gaps = Math.max(0, one.conveyances - 1) * BETWEEN_CONVEYANCES;
  const guides = one.conveyances * 2 * (guide + TO_GUIDES);
  const left = one.diameter - gaps - guides - 2 * TO_LINING;
  insist(left > 0, "that shaft has no room in it for a conveyance at all", "diameter");
  return round(Math.floor((left / one.conveyances) * 100) / 100, 2);
}

/**
 * The free area left for the ventilation, in square metres.
 *
 * What the fan actually has to work with, which is the shaft's area
 * less everything in it. A winding shaft is also a ventilation shaft at
 * most collieries, and the two duties are in direct competition: every
 * square metre of conveyance is a square metre the air has to go round.
 */
export function freeArea(one: Shaft, width: number, depthOf = 1.5, pipes = 1.2): number {
  positive(width, "width");
  positive(depthOf, "depthOf");
  nonNegative(pipes, "pipes");
  const taken = one.conveyances * width * depthOf + pipes;
  const left = area(one) - taken;
  insist(left > 0, "there is nothing left of that shaft for the air", "diameter");
  return round(left, 3);
}

/** The share of the shaft the air actually gets. */
export function freeShare(one: Shaft, width: number, depthOf = 1.5, pipes = 1.2): number {
  return round(freeArea(one, width, depthOf, pipes) / area(one), 4);
}

/** The air speed a stated quantity makes past the conveyances, in metres a second. */
export function airSpeed(one: Shaft, cubicMetresASecond: number, width: number, depthOf = 1.5): number {
  positive(cubicMetresASecond, "cubicMetresASecond");
  return round(cubicMetresASecond / freeArea(one, width, depthOf), 3);
}

/** The air speed above which a shaft is unpleasant to ride in. */
export const BRISK_AIR = 12;

/** Whether men can be wound in that air without complaint. */
export function comfortable(one: Shaft, cubicMetresASecond: number, width: number, depthOf = 1.5): boolean {
  return airSpeed(one, cubicMetresASecond, width, depthOf) <= BRISK_AIR;
}

/**
 * The overwind distance: how far above the bank a conveyance may go
 * before it strikes something, in metres.
 *
 * The headgear height less the sheave and the detaching plate. It is
 * the distance an overwind has to be stopped in, and it is why a
 * headgear is as tall as it is: the whole structure exists to give the
 * cage somewhere to go when the winding engineman has misjudged.
 */
export function overwindRoom(one: Shaft, sheave = 6, plate = 4): number {
  positive(sheave, "sheave");
  positive(plate, "plate");
  const left = one.headgear - sheave - plate;
  insist(left > 0, "that headgear has no room above the bank at all", "headgear");
  return round(left, 2);
}

/**
 * The speed an overwind may be running at and still be stopped in the
 * room available, in metres a second.
 *
 * From the room and the retardation the arrestor gear gives, which is
 * about a gravity — five or six times what the winding engine itself
 * can manage. That is the point. The engine cannot stop an overwind in
 * a headgear's worth of room and the arrestor gear can, and between
 * them stands the detaching hook: the one part of a winding
 * installation that is designed to break, and the only thing that stops
 * the rope pulling the cage into the sheave.
 */
export function stoppableFrom(one: Shaft, retardation = 9.81, sheave = 6, plate = 4): number {
  positive(retardation, "retardation");
  return round(Math.sqrt(2 * retardation * overwindRoom(one, sheave, plate)), 3);
}

/** The sump depth an underwind at a stated speed wants, in metres. */
export function sumpFor(speed: number, retardation = 9.81): number {
  nonNegative(speed, "speed");
  positive(retardation, "retardation");
  return roundUp((speed * speed) / (2 * retardation), 1);
}

/** Whether the sump is deep enough for the speed being wound at. */
export function sumpEnough(one: Shaft, speed: number, retardation = 9.81): boolean {
  return one.sump >= sumpFor(speed, retardation);
}

/**
 * The insets: where the shaft is opened out into the workings.
 *
 * A shaft rarely serves one seam. Each inset is a landing at a stated
 * depth, and the wind to each of them is a different wind — a different
 * length of rope hanging, a different out-of-balance, a different cycle
 * time. A winder sized on the deepest is oversized for the others and a
 * winder sized on the average will not do the deepest at all.
 */
export function insets(one: Shaft, at: readonly number[]): number[] {
  insist(at.length > 0, "a shaft with no insets serves nothing", "insets");
  for (const each of at) {
    checkDepth(each, "inset");
    insist(each <= one.depth, `an inset at ${each} m is below the bottom of a ${one.depth} m shaft`, "inset");
  }
  return [...at].sort((a, b) => a - b);
}

/** The deepest inset, which is what the winder has to be sized on. */
export function deepest(one: Shaft, at: readonly number[]): number {
  const found = insets(one, at);
  return found[found.length - 1] as number;
}

/** The lining volume a shaft of that size took, in cubic metres. */
export function liningVolume(one: Shaft, thickness = 0.45): number {
  positive(thickness, "thickness");
  const outside = one.diameter + 2 * thickness;
  return round((Math.PI * (outside * outside - one.diameter * one.diameter)) / 4 * (one.depth + one.sump), 1);
}

/** The ground taken out of a shaft of that size, in cubic metres. */
export function excavated(one: Shaft, thickness = 0.45): number {
  positive(thickness, "thickness");
  const outside = one.diameter + 2 * thickness;
  return round(((Math.PI * outside * outside) / 4) * (one.depth + one.sump), 1);
}

/** The shaft in a line, for the top of a report. */
export function describeShaft(one: Shaft): string {
  return (
    `${one.name}: ${one.diameter} m to ${one.depth} m, ` +
    `${one.conveyances} conveyances, ${one.sump} m sump, ${one.headgear} m headgear`
  );
}

/** The error this module throws, for a caller that wants to catch it. */
export function refuse(says: string, quantity: string): never {
  throw new WindingError(says, quantity);
}
