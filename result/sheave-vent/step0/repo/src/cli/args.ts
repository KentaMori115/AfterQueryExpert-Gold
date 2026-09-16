/**
 * Reading a command line.
 *
 * There is no argument parsing library here because there does not need
 * to be one. The commands take a handful of named values and one or two
 * positional ones, and every value that means a weight, a length, a
 * speed or a force is written the way it is written on a winding
 * sheet — "52mm", "942m", "15mps", "12t", "100tonf" — and read by the
 * quantity parser, which knows the units.
 *
 * What this file adds is only the shape of the line: which words are
 * positional, which are named, and what happens when a name is given
 * twice or a value is missing.
 */

import { WindingError } from "../errors.ts";
import { parseQuantity } from "../units/measure.ts";

/** A command line, taken apart. */
export interface Args {
  /** The words that were not attached to a name, in order. */
  readonly loose: readonly string[];
  /** The values that were given a name. */
  readonly named: Readonly<Record<string, string>>;
  /** The names that were given without a value. */
  readonly flags: readonly string[];
}

/**
 * A command line, taken apart.
 *
 * A word beginning with two dashes names the word after it, unless that
 * word also begins with two dashes or there is no word after it, in
 * which case the name is a flag. Everything else is loose, in the order
 * it was written. A name given twice is an error, because silently
 * keeping one of the two is how a certificate ends up describing a
 * machine nobody built.
 */
export function parseArgs(argv: readonly string[]): Args {
  const loose: string[] = [];
  const named: Record<string, string> = {};
  const flags: string[] = [];
  let at = 0;
  while (at < argv.length) {
    const word = argv[at] as string;
    if (!word.startsWith("--")) {
      loose.push(word);
      at += 1;
      continue;
    }
    const name = word.slice(2);
    if (name.length === 0) throw new WindingError("a bare pair of dashes names nothing", "argument");
    if (name in named || flags.includes(name)) throw new WindingError(`--${name} was given twice`, "argument");
    const next = argv[at + 1];
    if (next === undefined || next.startsWith("--")) {
      flags.push(name);
      at += 1;
    } else {
      named[name] = next;
      at += 2;
    }
  }
  return { loose, named, flags };
}

/** Whether a flag was given. */
export function flag(one: Args, name: string): boolean {
  return one.flags.includes(name);
}

/** A named value, or undefined. */
export function option(one: Args, name: string): string | undefined {
  return one.named[name];
}

/** A named value that has to be there. */
export function required(one: Args, name: string): string {
  const found = one.named[name];
  if (found === undefined) throw new WindingError(`this command needs --${name}`, name);
  return found;
}

/** A named value read as a plain number. */
export function number(one: Args, name: string, fallback?: number): number {
  const found = one.named[name];
  if (found === undefined) {
    if (fallback === undefined) throw new WindingError(`this command needs --${name}`, name);
    return fallback;
  }
  const value = Number(found);
  if (!Number.isFinite(value)) throw new WindingError(`${found} is not a number`, name);
  return value;
}

/**
 * A named value read as a quantity, in the library's own units.
 *
 * The canonical value rather than the number as written, which is the
 * whole reason the units are carried: `2in` is fifty and eight tenths of
 * a millimetre and `600fpm` is three and a twentieth metres a second,
 * and a command that took the number in front of the unit would be
 * wrong in both.
 */
export function quantity(one: Args, name: string, fallback?: number): number {
  const found = one.named[name];
  if (found === undefined) {
    if (fallback === undefined) throw new WindingError(`this command needs --${name}`, name);
    return fallback;
  }
  return parseQuantity(found, name).canonical;
}

/** A loose word that has to be there. */
export function word(one: Args, at: number, what: string): string {
  const found = one.loose[at];
  if (found === undefined) throw new WindingError(`this command needs ${what}`, what);
  return found;
}

/** Every name that was used, sorted, whether it had a value or not. */
export function namesUsed(one: Args): string[] {
  return [...Object.keys(one.named), ...one.flags].sort();
}

/**
 * The names a command does not understand.
 *
 * A mistyped name is worse than a missing one, because the command runs
 * and quietly uses its default — and a factor of safety worked on a
 * fifty-two millimetre rope rather than the thirty-two that was typed
 * looks exactly like a correct one. So every command says what it takes
 * and this says what was given that is not on the list.
 */
export function unknown(one: Args, known: readonly string[]): string[] {
  return namesUsed(one).filter((each) => !known.includes(each));
}

/** The args, with the unknown names refused. */
export function onlyKnown(one: Args, known: readonly string[]): Args {
  const strange = unknown(one, known);
  if (strange.length > 0) throw new WindingError(`this command does not take --${strange[0] as string}`, "argument");
  return one;
}
