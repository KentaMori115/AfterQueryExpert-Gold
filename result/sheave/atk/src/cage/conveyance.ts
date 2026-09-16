/**
 * What goes up and down: the cage, the skip, and the tare that is the
 * whole argument between them.
 *
 * A cage carries tubs and men. It weighs six or eight tonnes empty and
 * carries four, so two thirds of the work the winder does is lifting
 * the cage. A skip carries nothing but coal, discharges through its own
 * bottom, and weighs a third of what it carries — so a shaft converted
 * from cages to skips gets half as much coal again out of the same
 * winder, and loses the ability to wind men at all.
 *
 * That is the trade, and every colliery that ever made it kept a second
 * shaft with cages in for the men.
 */

import { WindingError, count, insist, nonNegative, positive, within } from "../errors.ts";
import { round, roundDown } from "../units/round.ts";
import { weightOf } from "../units/measure.ts";

/** What sort of thing is hung on the rope. */
export type Kind = "cage" | "skip" | "counterweight";

/** A conveyance, as built. */
export interface Conveyance {
  /** What it is called. */
  readonly name: string;
  /** What sort it is. */
  readonly kind: Kind;
  /** What it weighs empty, in kilograms. */
  readonly tare: number;
  /** What it will carry, in kilograms. */
  readonly payload: number;
  /** How many decks it has. */
  readonly decks: number;
  /** How wide it is across the shaft, in metres. */
  readonly width: number;
  /** How deep it is the other way, in metres. */
  readonly across: number;
}

/** A conveyance, checked. */
export function conveyance(over: Partial<Conveyance> = {}): Conveyance {
  const found: Conveyance = {
    name: over.name ?? "the cage",
    kind: over.kind ?? "cage",
    tare: over.tare ?? 8000,
    payload: over.payload ?? 4000,
    decks: over.decks ?? 2,
    width: over.width ?? 2.6,
    across: over.across ?? 1.5,
  };
  insist(found.name.trim().length > 0, "a conveyance has to be called something", "name");
  positive(found.tare, "tare");
  nonNegative(found.payload, "payload");
  count(found.decks, "decks");
  within(found.decks, 1, 6, "decks");
  positive(found.width, "width");
  positive(found.across, "across");
  insist(
    found.kind !== "counterweight" || found.payload === 0,
    "a counterweight does not carry anything; that is what makes it one",
    "payload",
  );
  return found;
}

/** A skip, which is a conveyance with no tare to speak of. */
export function skip(payload = 12_000, name = "the skip"): Conveyance {
  return conveyance({
    name,
    kind: "skip",
    payload,
    tare: round(payload * SKIP_TARE, 0),
    decks: 1,
    width: 2.2,
    across: 1.8,
  });
}

/** What a skip weighs empty, as a share of what it carries. */
export const SKIP_TARE = 0.42;

/** And what a cage weighs empty, as a share of what it carries. */
export const CAGE_TARE = 2.0;

/** The gross weight of a conveyance loaded, in kilograms. */
export function gross(one: Conveyance): number {
  return round(one.tare + one.payload, 3);
}

/** What it hangs on the rope loaded, in kilonewtons. */
export function loadedWeight(one: Conveyance): number {
  return weightOf(gross(one));
}

/** And empty. */
export function emptyWeight(one: Conveyance): number {
  return weightOf(one.tare);
}

/**
 * The useful load fraction: how much of what is lifted is paid for.
 *
 * A third for a cage and seven tenths for a skip, and there is the
 * whole argument. Every wind lifts the tare as well as the payload, and
 * on a cage installation two thirds of the winder, two thirds of the
 * rope and two thirds of the electricity are engaged in lifting an
 * empty steel box up and down a shaft.
 */
export function usefulFraction(one: Conveyance): number {
  const whole = gross(one);
  insist(whole > 0, "that conveyance weighs nothing at all", "tare");
  return round(one.payload / whole, 4);
}

/** The floor area a man is allowed in a cage, in square metres. */
export const A_MAN = 0.2;

/** What a man and his gear are taken to weigh, in kilograms. */
export const A_MAN_WEIGHS = 85;

/**
 * How many men a cage will carry.
 *
 * The lesser of what the floor will take and what the rope will. The
 * floor usually wins, which surprises people: a cage rated at four
 * tonnes of coal carries forty men weighing three and a half, and it is
 * the fifth of a square metre each that stops it carrying more.
 */
export function menIn(one: Conveyance): number {
  insist(one.kind === "cage", "only a cage carries men", "kind");
  const byFloor = Math.floor((one.width * one.across * one.decks) / A_MAN);
  const byRope = Math.floor(one.payload / A_MAN_WEIGHS);
  return Math.min(byFloor, byRope);
}

/** Which of the two limits is the one that binds. */
export function menLimitedBy(one: Conveyance): string {
  insist(one.kind === "cage", "only a cage carries men", "kind");
  const byFloor = Math.floor((one.width * one.across * one.decks) / A_MAN);
  const byRope = Math.floor(one.payload / A_MAN_WEIGHS);
  return byFloor <= byRope ? "floor" : "rope";
}

/** What a tub of coal weighs full, in kilograms. */
export const A_TUB = 750;

/** How many tubs a deck holds, and therefore the cage. */
export function tubsIn(one: Conveyance, aTub = A_TUB): number {
  positive(aTub, "aTub");
  insist(one.kind === "cage", "only a cage carries tubs", "kind");
  return Math.floor(one.payload / aTub);
}

/**
 * How much of a skip's volume is actually filled, as a share.
 *
 * Never all of it. A skip loaded from a measuring pocket is filled by
 * volume and paid for by weight, and the coal's bulk density varies
 * with how wet it is and how finely it is broken — so a skip run full
 * on a dry day is run over on a wet one, and the loading is set to
 * leave a margin.
 */
export const SKIP_FILL = 0.92;

/** The volume a skip of a stated payload wants, in cubic metres. */
export function skipVolume(one: Conveyance, bulk = 850, fill = SKIP_FILL): number {
  insist(one.kind === "skip", "only a skip is filled by volume", "kind");
  positive(bulk, "bulk");
  within(fill, 0.5, 1, "fill");
  return round(one.payload / bulk / fill, 3);
}

/** What a skip actually carries when the coal is wetter, in kilograms. */
export function skipCarries(one: Conveyance, bulk: number, volume: number, fill = SKIP_FILL): number {
  positive(bulk, "bulk");
  positive(volume, "volume");
  within(fill, 0.5, 1, "fill");
  return round(volume * fill * bulk, 1);
}

/**
 * Two conveyances balanced against each other: what is left over.
 *
 * A balanced wind hangs a loaded conveyance on one rope and an empty
 * one on the other, so the winder lifts only the payload — plus
 * whatever the two tares differ by, which on a matched pair is nothing
 * and on a pair where one cage has been rebuilt is a great deal more
 * than anybody expects.
 */
export function outOfBalance(rising: Conveyance, falling: Conveyance): number {
  return round(gross(rising) - falling.tare, 3);
}

/** The same as a weight, in kilonewtons. */
export function outOfBalanceWeight(rising: Conveyance, falling: Conveyance): number {
  return weightOf(outOfBalance(rising, falling));
}

/** Whether two conveyances are a matched pair. */
export function matched(one: Conveyance, other: Conveyance, tolerance = 0.02): boolean {
  within(tolerance, 0, 0.5, "tolerance");
  const mean = (one.tare + other.tare) / 2;
  insist(mean > 0, "neither of those weighs anything", "tare");
  return Math.abs(one.tare - other.tare) / mean <= tolerance;
}

/**
 * The counterweight a single-conveyance winder wants, in kilograms.
 *
 * The tare plus half the payload, which balances the installation at
 * half load and leaves the winder lifting half the payload one way and
 * lowering it the other. It is the best a single conveyance can do and
 * it is worse than a matched pair, because the counterweight is dead
 * weight that has to be accelerated as well.
 */
export function counterweightFor(one: Conveyance): number {
  return round(one.tare + one.payload / 2, 0);
}

/** That counterweight as a conveyance in its own right. */
export function counterweight(one: Conveyance): Conveyance {
  return conveyance({
    name: "the counterweight",
    kind: "counterweight",
    tare: counterweightFor(one),
    payload: 0,
    decks: 1,
    width: one.width * 0.6,
    across: one.across * 0.6,
  });
}

/**
 * The payload a rope will allow, given what the conveyance weighs, in
 * kilograms.
 *
 * Rounded down to the hundredweight, because a colliery loaded in them
 * and because rounding up would allow a wind the rope does not.
 */
export function payloadAllowed(one: Conveyance, allowedWeight: number): number {
  positive(allowedWeight, "allowedWeight");
  const kilograms = (allowedWeight * 1000) / 9.80665 - one.tare;
  insist(kilograms > 0, "that rope will not lift the empty conveyance", "allowedWeight");
  return roundDown(kilograms / 50.8, 0) * 50.8;
}

/** The conveyance in a line, for a report. */
export function describeConveyance(one: Conveyance): string {
  return (
    `${one.name}: a ${one.kind} of ${round(one.tare / 1000, 2)} t tare carrying ${round(one.payload / 1000, 2)} t, ` +
    `${round(usefulFraction(one) * 100, 1)}% useful`
  );
}

/** A conveyance kind by name, or a refusal that says which are known. */
export function kindNamed(name: string): Kind {
  const known: readonly Kind[] = ["cage", "skip", "counterweight"];
  const found = known.find((each) => each === name.trim());
  if (found === undefined) {
    throw new WindingError(`${name} is not a conveyance this library knows (${known.join(", ")})`, "kind");
  }
  return found;
}
