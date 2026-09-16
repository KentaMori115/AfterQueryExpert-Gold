/**
 * The airway, and what it costs to put air down it.
 *
 * A winding shaft is also the colliery's downcast, and the two duties
 * are in direct competition: the shaft module says how many square
 * metres the conveyances leave the air, and this says what the fan pays
 * for the ones that are left. It pays a great deal, because resistance
 * goes as the cube of the area. Take a tenth off the section of a shaft
 * and the fan does not pay a tenth more for its air, it pays a third.
 *
 * That cube is the whole argument between winding and ventilation, and
 * it is why the two were settled together on every colliery that was
 * ever laid out properly and separately on every one that was not.
 */

import { insist, nonNegative, positive } from "../errors.ts";
import { round } from "../units/round.ts";
import { type Shaft, freeArea } from "../shaft/index.ts";

/** A length of the ventilation, as the air finds it. */
export interface Airway {
  /** What it is called. */
  readonly name: string;
  /** How long the air is in it, in metres. */
  readonly length: number;
  /** The section the air has, in square metres. */
  readonly area: number;
  /** What the air rubs against on the way, in metres round. */
  readonly perimeter: number;
  /** The friction of the surface, in kilograms a cubic metre. */
  readonly friction: number;
}

/**
 * The friction of a lined shaft, in kilograms a cubic metre.
 *
 * Concrete or brick, and smooth. A timbered shaft is three times this
 * and a shaft in the rough as it was sunk is more again, which is a
 * reason for lining one that has nothing to do with holding it up.
 */
export const FRICTION = 0.004;

/** An airway, checked. */
export function airway(
  name: string,
  length: number,
  area0: number,
  perimeter: number,
  friction = FRICTION,
): Airway {
  insist(name.trim().length > 0, "an airway has to be called something", "name");
  positive(length, "length");
  positive(area0, "area");
  positive(perimeter, "perimeter");
  positive(friction, "friction");
  return { name: name.trim(), length, area: area0, perimeter, friction };
}

/** What the air rubs against for the whole length of it, in square metres. */
export function rubbingSurface(one: Airway): number {
  return round(one.perimeter * one.length, 2);
}

/**
 * The unit a resistance is quoted in has no agreed name and the numbers
 * are small: a whole colliery comes to a few hundredths, a shaft on its
 * own to a few thousandths, and a door standing open to less than
 * either, which is why the arithmetic is done in resistances and
 * reported in pressures and quantities that a person can picture.
 */

/**
 * The resistance of an airway.
 *
 * The friction, the surface the air rubs against, and the section it
 * has, which comes in cubed: once for the air that has to get through
 * and twice for the speed it has to do it at. The unit has no name
 * anybody uses and the number is small, so a whole colliery comes to a
 * few hundredths and a shaft on its own to a few thousandths.
 *
 * The cube is the part worth staring at. Everything else about an
 * airway is linear — twice the length is twice the resistance, twice
 * the friction is twice the resistance — and the section is not. A
 * roadway ripped from three metres square to three and a half is not
 * a sixth easier, it is a third easier, and a level allowed to close
 * in by the same amount costs the same in the other direction. Every
 * argument in colliery ventilation that looks like an argument about
 * money is really this exponent being discovered again by somebody.
 */
export function resistance(one: Airway): number {
  return round((one.friction * one.perimeter * one.length) / (one.area * one.area * one.area), 6);
}

/**
 * The pressure a quantity of air wants against a resistance, in pascals.
 *
 * The square is the whole difficulty of ventilating a colliery. Twice
 * the air is four times the pressure and eight times the power, so a
 * pit that wants half as much air again wants better than three times
 * the fan it has, and the fan house was built for the fan it has.
 */
export function pressureFor(resistance0: number, quantity: number): number {
  positive(resistance0, "resistance");
  nonNegative(quantity, "quantity");
  return round(resistance0 * quantity * quantity, 2);
}


/**
 * The work being done on the air, in kilowatts.
 *
 * Pressure by quantity, which comes out in watts and is reported here
 * in the kilowatts the rest of the library uses for power. A colliery
 * fan is a few hundred of them and runs every hour of the year, which
 * makes it the largest single item on a pit's electricity bill after
 * the winder itself, and unlike the winder it never stops.
 */
export function airPower(pressure: number, quantity: number): number {
  nonNegative(pressure, "pressure");
  nonNegative(quantity, "quantity");
  return round((pressure * quantity) / 1000, 3);
}

/** How fast the air goes down an airway, in metres a second. */
export function velocity(one: Airway, quantity: number): number {
  nonNegative(quantity, "quantity");
  return round(quantity / one.area, 3);
}



/** Airways the air goes through one after another. */
export function inSeries(resistances: readonly number[]): number {
  insist(resistances.length > 0, "nothing was given to put in series", "resistances");
  let sum = 0;
  for (const each of resistances) sum += positive(each, "resistance");
  return round(sum, 6);
}

/**
 * Airways the air splits between.
 *
 * Two roads side by side are easier than either of them alone, and the
 * arithmetic is the one place in ventilation where the square roots
 * come out where nobody expects them. Splitting the air is the cheapest
 * thing a colliery can do to its fan bill and the reason every pit that
 * could split its districts did.
 */
export function inParallel(resistances: readonly number[]): number {
  insist(resistances.length > 0, "nothing was given to put in parallel", "resistances");
  let sum = 0;
  for (const each of resistances) sum += 1 / Math.sqrt(positive(each, "resistance"));
  return round(1 / (sum * sum), 6);
}


/**
 * A winding shaft as the air finds it.
 *
 * The length is the depth, the section is what the conveyances and the
 * pipes leave, and the surface the air rubs against is the lining —
 * which is the whole way round the shaft and not the way round what is
 * left of it, because the air rubs on the wall whatever is hanging in
 * the middle of it.
 */
export function shaftAirway(one: Shaft, width: number, depthOf = 1.5, pipes = 1.2, friction = FRICTION): Airway {
  return airway(one.name, one.depth, freeArea(one, width, depthOf, pipes), Math.PI * one.diameter, friction);
}



/** The airway described in a line. */
export function describeAirway(one: Airway): string {
  return `${one.name}: ${one.length} m of ${one.area} m², ${resistance(one)} of resistance`;
}
