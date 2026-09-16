/**
 * The units a winding sheet is written in, and the ones it is not.
 *
 * A colliery winder is described in a mixture that has never settled.
 * The shaft is in metres and was sunk in fathoms; the rope is in
 * millimetres and was ordered in inches; the payload is in tonnes and
 * was hoisted in hundredweight; the speed is in metres a second and the
 * old men still say feet a minute. All of them appear on the same
 * sheet, and a quantity without a unit on that sheet is the commonest
 * fault in the subject.
 *
 * So this module refuses a bare number wherever a unit could be meant.
 * The one exception is a percentage, because a figure written `4.5` in
 * a column headed slip is not in doubt.
 */

import { WindingError, insist, nonNegative, positive, real, within } from "../errors.ts";
import { round } from "./round.ts";

/** Standard gravity, in metres a second squared. */
export const GRAVITY = 9.80665;

/** A long ton in kilograms, because a colliery weighed in them. */
export const LONG_TON = 1016.046_908_8;

/** A hundredweight, which is a twentieth of one. */
export const HUNDREDWEIGHT = LONG_TON / 20;

/** A fathom in metres, because a shaft was sunk in them. */
export const FATHOM = 1.828_8;

/** A horsepower in kilowatts, because a winding engine was rated in them. */
export const HORSEPOWER = 0.745_699_872;

/** The density of steel, in kilograms a cubic metre. */
export const STEEL = 7850;

/** What sort of quantity a unit measures. */
export type Dimension = "mass" | "length" | "speed" | "power" | "force" | "time" | "share" | "rate";

interface Unit {
  readonly canonical: string;
  readonly dimension: Dimension;
  readonly factor: number;
}

/**
 * Every unit the reader knows, and what it is in the canonical one.
 *
 * The canonical units are kilograms, metres, metres a second,
 * kilowatts, kilonewtons, seconds, per cent, and tonnes an hour. A
 * winding sheet is written in every one of them and in several others,
 * and the others are converted here and nowhere else.
 */
const UNITS: Readonly<Record<string, Unit>> = {
  kg: { canonical: "kg", dimension: "mass", factor: 1 },
  t: { canonical: "kg", dimension: "mass", factor: 1000 },
  lt: { canonical: "kg", dimension: "mass", factor: LONG_TON },
  cwt: { canonical: "kg", dimension: "mass", factor: HUNDREDWEIGHT },

  m: { canonical: "m", dimension: "length", factor: 1 },
  mm: { canonical: "m", dimension: "length", factor: 0.001 },
  ft: { canonical: "m", dimension: "length", factor: 0.3048 },
  in: { canonical: "m", dimension: "length", factor: 0.0254 },
  fm: { canonical: "m", dimension: "length", factor: FATHOM },
  yd: { canonical: "m", dimension: "length", factor: 0.9144 },

  mps: { canonical: "mps", dimension: "speed", factor: 1 },
  fpm: { canonical: "mps", dimension: "speed", factor: 0.3048 / 60 },
  kph: { canonical: "mps", dimension: "speed", factor: 1000 / 3600 },

  kw: { canonical: "kw", dimension: "power", factor: 1 },
  mw: { canonical: "kw", dimension: "power", factor: 1000 },
  hp: { canonical: "kw", dimension: "power", factor: HORSEPOWER },

  kn: { canonical: "kn", dimension: "force", factor: 1 },
  n: { canonical: "kn", dimension: "force", factor: 0.001 },
  tonf: { canonical: "kn", dimension: "force", factor: (LONG_TON * GRAVITY) / 1000 },

  s: { canonical: "s", dimension: "time", factor: 1 },
  min: { canonical: "s", dimension: "time", factor: 60 },
  h: { canonical: "s", dimension: "time", factor: 3600 },

  "%": { canonical: "%", dimension: "share", factor: 1 },

  tph: { canonical: "tph", dimension: "rate", factor: 1 },
  tpd: { canonical: "tph", dimension: "rate", factor: 1 / 24 },
};

/** A quantity as it was written and as it is meant. */
export interface Quantity {
  /** The number in front of the unit. */
  readonly value: number;
  /** The unit as written. */
  readonly unit: string;
  /** The value in the canonical unit for its dimension. */
  readonly canonical: number;
  /** What the canonical unit is. */
  readonly of: string;
  /** What sort of thing it measures. */
  readonly dimension: Dimension;
}

/**
 * Read a quantity written the way a winding sheet writes one.
 *
 * A number, then a unit, with or without a space between them: `40mm`,
 * `900 m`, `12tonf`, `4.5%`, `600 fpm`. A number on its own is refused,
 * because a bare `40` in a column that could hold millimetres or
 * inches has meant both on the same sheet.
 */
export function parseQuantity(text: string, quantity = "quantity"): Quantity {
  const cleaned = text.trim().toLowerCase();
  const found = /^(-?\d+(?:\.\d+)?)\s*([a-z%][a-z0-9]*)$/.exec(cleaned);
  if (found === null) {
    throw new WindingError(`${quantity} must be a number with a unit, like 40mm: ${text}`, quantity);
  }
  const value = Number(found[1]);
  const unit = found[2] as string;
  const known = UNITS[unit];
  if (known === undefined) {
    throw new WindingError(`${unit} is not a unit this library knows (${Object.keys(UNITS).join(", ")})`, quantity);
  }
  real(value, quantity);
  return { value, unit, canonical: value * known.factor, of: known.canonical, dimension: known.dimension };
}

function ofDimension(text: string, dimension: Dimension, quantity: string): number {
  const found = parseQuantity(text, quantity);
  if (found.dimension !== dimension) {
    throw new WindingError(`${quantity} wants a ${dimension} and ${found.unit} is a ${found.dimension}`, quantity);
  }
  return found.canonical;
}

/** Read a mass, in kilograms. */
export function parseMass(text: string, quantity = "mass"): number {
  return ofDimension(text, "mass", quantity);
}

/** Read a length, in metres. */
export function parseLength(text: string, quantity = "length"): number {
  return ofDimension(text, "length", quantity);
}

/** Read a speed, in metres a second. */
export function parseSpeed(text: string, quantity = "speed"): number {
  return ofDimension(text, "speed", quantity);
}

/** Read a power, in kilowatts. */
export function parsePower(text: string, quantity = "power"): number {
  return ofDimension(text, "power", quantity);
}

/** Read a force, in kilonewtons. */
export function parseForce(text: string, quantity = "force"): number {
  return ofDimension(text, "force", quantity);
}

/** Read a time, in seconds. */
export function parseTime(text: string, quantity = "time"): number {
  return ofDimension(text, "time", quantity);
}

/** Read a rate, in tonnes an hour. */
export function parseRate(text: string, quantity = "rate"): number {
  return ofDimension(text, "rate", quantity);
}

/**
 * Read a share, taking a bare number as a percentage.
 *
 * A slip is written `4.5` as often as `4.5%` and the dimension is not
 * in doubt, so this one reader takes a bare number where every other
 * refuses it.
 */
export function parseShare(text: string, quantity = "share"): number {
  const cleaned = text.trim();
  if (/^-?\d+(\.\d+)?$/.test(cleaned)) return within(Number(cleaned), 0, 100, quantity);
  return ofDimension(cleaned, "share", quantity);
}

/** The weight of a mass, in kilonewtons. */
export function weightOf(kilograms: number): number {
  nonNegative(kilograms, "kilograms");
  return round((kilograms * GRAVITY) / 1000, 6);
}

/**
 * The force a signed mass difference makes, in kilonewtons.
 *
 * `weightOf` refuses a negative mass, and rightly: nothing weighs less
 * than nothing. But an out-of-balance is a difference between two
 * masses and is negative for half of every wind, and converting it
 * needs the same constant without the guard. Keeping the two apart is
 * the point — a negative *weight* is a mistake and a negative
 * out-of-balance is Tuesday.
 */
export function forceOf(kilograms: number): number {
  real(kilograms, "kilograms");
  return round((kilograms * GRAVITY) / 1000, 6);
}

/** The mass a weight belongs to, in kilograms. */
export function massOf(kilonewtons: number): number {
  nonNegative(kilonewtons, "kilonewtons");
  return round((kilonewtons * 1000) / GRAVITY, 6);
}

/** A force in the tons force a rope maker's table is printed in. */
export function asTonsForce(kilonewtons: number): number {
  return round((kilonewtons * 1000) / (LONG_TON * GRAVITY), 4);
}

/** A speed in the feet a minute the old men still say. */
export function asFeetAMinute(metresASecond: number): number {
  return round(metresASecond / (0.3048 / 60), 1);
}

/** A depth in the fathoms the shaft was sunk in. */
export function asFathoms(metres: number): number {
  return round(metres / FATHOM, 2);
}

/** A power in the horsepower the engine was rated in. */
export function asHorsepower(kilowatts: number): number {
  return round(kilowatts / HORSEPOWER, 1);
}

/** A mass in the hundredweight a colliery weighed in. */
export function asHundredweight(kilograms: number): number {
  return round(kilograms / HUNDREDWEIGHT, 2);
}

/**
 * The area of a circle of a stated diameter, in square millimetres.
 *
 * Written out because it appears in every rope calculation in the
 * library and because writing it out once is the only way to be sure
 * nobody has used the radius.
 */
export function circleArea(diameter: number): number {
  positive(diameter, "diameter");
  return round((Math.PI * diameter * diameter) / 4, 6);
}

/** The mass of a length of solid steel bar, in kilograms a metre. */
export function barMass(diameter: number): number {
  return round((circleArea(diameter) * 1e-6 * STEEL), 6);
}

/** Whether a set of shares add to a hundred, within a tolerance. */
export function addsUp(shares: Readonly<Record<string, number>>, tolerance = 0.5): boolean {
  positive(tolerance, "tolerance");
  const sum = Object.values(shares).reduce((at, each) => at + real(each, "share"), 0);
  return Math.abs(sum - 100) <= tolerance;
}

/** The sum of a set of shares. */
export function addsTo(shares: Readonly<Record<string, number>>): number {
  return round(Object.values(shares).reduce((at, each) => at + real(each, "share"), 0), 4);
}

/** A quantity scaled from a shift to a day, or the other way. */
export function perShift(perDay: number, shifts = 3): number {
  positive(shifts, "shifts");
  insist(Number.isInteger(shifts), "a colliery works a whole number of shifts", "shifts");
  return round(perDay / shifts, 4);
}
