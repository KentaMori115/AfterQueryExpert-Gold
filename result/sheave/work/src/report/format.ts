/**
 * Saying a number the way a colliery says it.
 *
 * Every quantity here has a way it is written down and it is not the
 * way a computer would write it. A rope diameter is whole millimetres,
 * because that is how a rope is ordered. A factor of safety is two
 * places, because the third is where the argument always is. A depth is
 * whole metres, because nobody surveys a shaft to a centimetre and
 * pretending otherwise is a kind of lying. A cycle time is a tenth of a
 * second, because that is what a stopwatch on the bank gives.
 *
 * The fathoms and the feet a minute are here because the trade still
 * speaks in them. A shaft of nine hundred and forty-two metres is five
 * hundred and fifteen fathoms, and there are winding enginemen who know
 * the second figure and not the first.
 */

import { WindingError, real } from "../errors.ts";
import { round } from "../units/round.ts";
import { asFathoms, asFeetAMinute, asHorsepower, asHundredweight, asTonsForce } from "../units/measure.ts";

/** A number to a fixed number of places, with the sign done properly. */
export function places(value: number, howMany = 2): string {
  real(value, "value");
  const found = round(value, howMany);
  return (found === 0 ? 0 : found).toFixed(howMany);
}

function grouped(text: string): string {
  const [whole, part] = text.split(".");
  const found = (whole ?? "0").replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return part === undefined ? found : `${found}.${part}`;
}

/** A depth or a length, in whole metres. */
export function metres(value: number, howMany = 0): string {
  return `${grouped(places(value, howMany))} m`;
}

/** The same in the fathoms the shaft was sunk in. */
export function fathoms(value: number): string {
  return `${grouped(places(asFathoms(value), 0))} fm`;
}

/** A rope diameter, in whole millimetres. */
export function millimetres(value: number): string {
  return `${grouped(places(value, 0))} mm`;
}

/** A weight, in tonnes. */
export function tonnes(value: number, howMany = 2): string {
  return `${grouped(places(value / 1000, howMany))} t`;
}

/** The same in the hundredweight a colliery weighed in. */
export function hundredweight(value: number): string {
  return `${grouped(places(asHundredweight(value), 1))} cwt`;
}

/** A weight in kilograms, for the things that are quoted in them. */
export function kilograms(value: number, howMany = 0): string {
  return `${grouped(places(value, howMany))} kg`;
}

/** A rope's weight a metre. */
export function perMetre(value: number): string {
  return `${places(value, 2)} kg/m`;
}

/** A force, in kilonewtons. */
export function force(value: number, howMany = 1): string {
  return `${grouped(places(value, howMany))} kN`;
}

/** The same in the tons force a rope maker's table is printed in. */
export function tonsForce(value: number): string {
  return `${grouped(places(asTonsForce(value), 1))} tonf`;
}

/** A speed, in metres a second. */
export function speed(value: number): string {
  return `${places(value, 2)} m/s`;
}

/** The same in the feet a minute the old men still say. */
export function feetAMinute(value: number): string {
  return `${grouped(places(asFeetAMinute(value), 0))} ft/min`;
}

/** A power, in kilowatts. */
export function power(value: number): string {
  return `${grouped(places(value, 0))} kW`;
}

/** The same in the horsepower the engine was rated in. */
export function horsepower(value: number): string {
  return `${grouped(places(asHorsepower(value), 0))} hp`;
}

/** A time, in seconds. */
export function seconds(value: number): string {
  return `${places(value, 1)} s`;
}

/** A longer time, in minutes. */
export function minutes(value: number): string {
  return `${places(value, 1)} min`;
}

/** A factor of safety, which wants two places. */
export function factor(value: number): string {
  return places(value, 2);
}

/** A plain ratio. */
export function ratio(value: number): string {
  return places(value, 2);
}

/** A share, given as a percentage. */
export function share(value: number, howMany = 1): string {
  return `${places(value * 100, howMany)}%`;
}

/** A percentage already in percentage points. */
export function percent(value: number, howMany = 1): string {
  return `${places(value, howMany)}%`;
}

/** An angle, in degrees. */
export function degrees(value: number): string {
  return `${places(value, 2)}°`;
}

/** A stress, in newtons a square millimetre. */
export function stress(value: number): string {
  return `${grouped(places(value, 0))} N/mm²`;
}

/** A number of winds, which is large and wants its thousands marked. */
export function winds(value: number): string {
  return grouped(places(value, 0));
}

/** An output, in tonnes an hour. */
export function perHour(value: number): string {
  return `${grouped(places(value, 1))} t/h`;
}

/** And in tonnes a day. */
export function perDay(value: number): string {
  return `${grouped(places(value, 0))} t/d`;
}

/** An energy, in kilowatt hours a tonne. */
export function energy(value: number): string {
  return `${places(value, 3)} kWh/t`;
}

/** Money, in pounds. */
export function pounds(value: number, howMany = 0): string {
  return `£${grouped(places(value, howMany))}`;
}

/** Money, in pence. */
export function pence(value: number): string {
  return `${places(value, 2)}p`;
}

/** A number that may be either way and wants its sign shown. */
export function signed(value: number, howMany = 1): string {
  const found = round(value, howMany);
  return `${found > 0 ? "+" : ""}${places(found, howMany)}`;
}

/** A label and a value, lined up in a column. */
export function line(label: string, value: string, width = 34): string {
  if (label.length >= width) return `${label} ${value}`;
  return `${label}${" ".repeat(width - label.length)}${value}`;
}

/** A heading, with a rule under it. */
export function heading(said: string): string[] {
  return [said, "-".repeat(said.length)];
}

/** Prose wrapped to a width. */
export function wrapped(said: string, width = 78): string[] {
  const out: string[] = [];
  let row = "";
  for (const word of said.split(/\s+/).filter((each) => each !== "")) {
    if (row.length === 0) row = word;
    else if (row.length + 1 + word.length <= width) row = `${row} ${word}`;
    else {
      out.push(row);
      row = word;
    }
  }
  if (row.length > 0) out.push(row);
  return out;
}

/** A sentence, with its first letter up. */
export function sentence(said: string): string {
  if (said.length === 0) return said;
  return (said[0] ?? "").toUpperCase() + said.slice(1);
}

/** A yes or a no, for a column of them. */
export function verdict(passed: boolean): string {
  if (typeof passed !== "boolean") throw new WindingError("a verdict is a yes or a no", "verdict");
  return passed ? "yes" : "no";
}

/** A list of words with an "and" before the last of them. */
export function listed(words: readonly string[]): string {
  if (words.length === 0) throw new WindingError("there is nothing in that list", "words");
  if (words.length === 1) return words[0] as string;
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1] as string}`;
}

/** A word made plural when there is not exactly one of the thing. */
export function many(howMany: number, word: string, plural = `${word}s`): string {
  real(howMany, "howMany");
  return `${round(howMany, 0)} ${howMany === 1 ? word : plural}`;
}

/** A name written in one word, spaced out for a table. */
export function spaced(name: string): string {
  return name.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
}
