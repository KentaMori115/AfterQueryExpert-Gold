/**
 * Rounding, and the small arithmetic everything else leans on.
 *
 * A rope diameter is quoted to the millimetre and a factor of safety to
 * two places, and the two meet in a calculation that has to hold at the
 * bank, at the pit bottom and at every point of rope between them. So
 * there is one rounding function here and everything uses it, and
 * nothing rounds on the way through a calculation — only on the way out
 * of one.
 */

import { WindingError, real } from "../errors.ts";

/**
 * Round to a number of decimal places, half away from zero.
 *
 * Negative zero is turned back into zero on the way out. It is not
 * pedantry: a "-0.00 kilograms" against a line on a winding sheet is a
 * thing somebody stands and looks at, and the sign came from a rounding
 * rather than from the winder.
 */
export function round(value: number, places = 0): number {
  real(value, "value");
  if (!Number.isInteger(places) || places < 0 || places > 12) {
    throw new WindingError("places must be a whole number between 0 and 12", "places");
  }
  const scale = 10 ** places;
  const scaled = value * scale;
  const rounded = scaled < 0 ? -Math.round(-scaled) : Math.round(scaled);
  const found = rounded / scale;
  return found === 0 ? 0 : found;
}

/**
 * Round away from zero, for a quantity somebody has to have all of.
 *
 * A wind is a whole wind and a rope is a whole rope. Where a number says
 * how much of something is needed, the fraction left over still has to
 * be provided, and providing it means providing another one of them.
 */
export function roundUp(value: number, places = 0): number {
  real(value, "value");
  if (!Number.isInteger(places) || places < 0 || places > 12) {
    throw new WindingError("places must be a whole number between 0 and 12", "places");
  }
  const scale = 10 ** places;
  const scaled = value * scale;
  const rounded = scaled < 0 ? -Math.ceil(-scaled) : Math.ceil(scaled - 1e-9);
  const found = rounded / scale;
  return found === 0 ? 0 : found;
}

/**
 * Round towards zero, for a quantity somebody is allowed at most of.
 *
 * The mirror of `roundUp`. A payload worked out against a rope's
 * strength is taken to the hundredweight below, because the one above is
 * a rope being worked past its factor of safety.
 */
export function roundDown(value: number, places = 0): number {
  real(value, "value");
  if (!Number.isInteger(places) || places < 0 || places > 12) {
    throw new WindingError("places must be a whole number between 0 and 12", "places");
  }
  const scale = 10 ** places;
  const scaled = value * scale;
  const rounded = scaled < 0 ? -Math.floor(-scaled) : Math.floor(scaled + 1e-9);
  const found = rounded / scale;
  return found === 0 ? 0 : found;
}

/** Where a number sits between two others, as a share. */
export function between(value: number, low: number, high: number): number {
  real(value, "value");
  if (high === low) throw new WindingError("nothing lies between a number and itself", "range");
  return (value - low) / (high - low);
}

/**
 * A value read off a table between two of its entries.
 *
 * Every rope maker's table in existence is printed at round diameters
 * and read at the ones a shaft actually has on it, which are never
 * round, so this is the commonest operation in the subject. It is a
 * straight line between two entries, which is what the tables assume
 * and what the people using them do.
 */
export function interpolate(
  at: number,
  low: number,
  high: number,
  atLow: number,
  atHigh: number,
): number {
  real(at, "at");
  return atLow + between(at, low, high) * (atHigh - atLow);
}

/** Whether two numbers are the same to within a tolerance. */
export function near(first: number, second: number, tolerance = 1e-6): boolean {
  real(first, "first");
  real(second, "second");
  return Math.abs(first - second) <= Math.abs(tolerance);
}

/** The sum of a list, which is written out because it is written out everywhere. */
export function total(values: readonly number[]): number {
  return values.reduce((sum, each) => sum + real(each, "value"), 0);
}
