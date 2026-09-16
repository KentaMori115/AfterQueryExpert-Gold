/**
 * What winding costs, and what the rope costs that nobody counts.
 *
 * A winding installation is cheap to run and expensive to stop. The
 * electricity is a few pence a tonne; the rope is a few pence a tonne;
 * the men on the bank and at the pit bottom are rather more than
 * either; and the day the winder is down the whole colliery is down,
 * which is the number that decides everything.
 *
 * That last one is why a colliery maintains a winder the way it does
 * and why the arithmetic of a rope change is not the arithmetic of the
 * rope. A rope costs what a rope costs. Changing one takes a shift, and
 * a shift is the whole pit.
 */

import { insist, nonNegative, positive, within } from "../errors.ts";
import { round } from "../units/round.ts";
import { type Rope, lifeIn, massPerMetre } from "../rope/index.ts";
import { type Winder, drumOf, energyADay, energyATonne, outputPerDay, ropeWanted, windsPerHour } from "../winder/index.ts";

/** What the colliery pays for things. */
export interface Prices {
  /** Electricity, in pence a kilowatt hour. */
  readonly power: number;
  /** Winding rope, in pounds a tonne of rope. */
  readonly rope: number;
  /** What a shift of the whole colliery is worth, in pounds. */
  readonly shift: number;
  /** What the winding men cost a shift, in pounds. */
  readonly men: number;
  /** What a rope change takes, in shifts. */
  readonly changeShifts: number;
}

/** The prices, with an ordinary set where none are given. */
export function prices(over: Partial<Prices> = {}): Prices {
  const found: Prices = {
    power: over.power ?? 9,
    rope: over.rope ?? 2400,
    shift: over.shift ?? 42_000,
    men: over.men ?? 640,
    changeShifts: over.changeShifts ?? 1.5,
  };
  for (const [name, value] of Object.entries(found)) positive(value, name);
  return found;
}

/** What a rope costs to buy, in pounds. */
export function ropeCost(one: Rope, metres: number, at = prices()): number {
  positive(metres, "metres");
  return round(((massPerMetre(one) * metres) / 1000) * at.rope, 2);
}

/**
 * What a rope change costs altogether, in pounds.
 *
 * The rope, the men who change it, and the colliery that is standing
 * while they do. The third of those is nine tenths of the number, which
 * is why a works will pay a great deal for a rope that lasts longer and
 * nothing at all for one that is cheaper.
 */
export function changeCost(one: Rope, metres: number, at = prices()): number {
  return round(ropeCost(one, metres, at) + at.changeShifts * (at.shift + at.men), 2);
}

/** How often a rope has to be changed, in days, at a stated winding rate. */
export function changeEvery(one: Winder, at = prices()): number {
  const barrel = drumOf(one);
  const winds = lifeIn(one.rope, barrel.diameter);
  const perHour = windsPerHour(one);
  insist(perHour > 0, "that winder makes no winds", "profile");
  void at;
  return round(winds / (perHour * one.hours), 1);
}

/** What the rope costs a tonne of coal raised, in pence. */
export function ropePerTonne(one: Winder, at = prices()): number {
  const days = changeEvery(one, at);
  const raised = outputPerDay(one) * days;
  insist(raised > 0, "that winder raises nothing", "profile");
  return round((changeCost(one.rope, ropeWanted(one), at) * 100) / raised, 4);
}

/** What the electricity costs a tonne raised, in pence. */
export function powerPerTonne(one: Winder, at = prices()): number {
  return round(energyATonne(one) * at.power, 4);
}

/** What the men cost a tonne raised, in pence. */
export function menPerTonne(one: Winder, at = prices(), shifts = 3): number {
  positive(shifts, "shifts");
  const raised = outputPerDay(one);
  insist(raised > 0, "that winder raises nothing", "profile");
  return round((at.men * shifts * 100) / raised, 4);
}

/** What winding costs a tonne altogether, in pence. */
export function perTonne(one: Winder, at = prices(), shifts = 3): number {
  return round(powerPerTonne(one, at) + ropePerTonne(one, at) + menPerTonne(one, at, shifts), 4);
}

/** The three lines of it, for a table. */
export function lines(one: Winder, at = prices(), shifts = 3): Readonly<Record<string, number>> {
  return {
    power: powerPerTonne(one, at),
    rope: ropePerTonne(one, at),
    men: menPerTonne(one, at, shifts),
  };
}

/** What a day of winding costs, in pounds. */
export function aDay(one: Winder, at = prices(), shifts = 3): number {
  return round((perTonne(one, at, shifts) * outputPerDay(one)) / 100, 2);
}

/** What a day of the winder being down costs, in pounds. */
export function aDayDown(at = prices(), shifts = 3): number {
  positive(shifts, "shifts");
  return round(at.shift * shifts, 2);
}

/**
 * What a bigger drum is worth, in pounds a year.
 *
 * A drum ten per cent larger buys rather more than ten per cent of rope
 * life, because bending fatigue goes as a high power of the ratio — and
 * every rope change avoided is a shift of the colliery. It is the
 * clearest example in this library of a capital decision that is
 * decided by a maintenance figure rather than by a running one.
 */
export function biggerDrumWorth(one: Winder, largerBy: number, at = prices(), days = 300): number {
  within(largerBy, 0, 1, "largerBy");
  const barrel = drumOf(one);
  const now = lifeIn(one.rope, barrel.diameter);
  const then = lifeIn(one.rope, barrel.diameter * (1 + largerBy));
  const perHour = windsPerHour(one);
  insist(perHour > 0 && now > 0, "that winder makes no winds", "profile");
  const changesNow = (perHour * one.hours * days) / now;
  const changesThen = (perHour * one.hours * days) / then;
  return round((changesNow - changesThen) * changeCost(one.rope, ropeWanted(one), at), 0);
}

/** What a second off the standing time is worth, in pounds a year. */
export function secondWorth(one: Winder, margin: number, at = prices(), days = 300): number {
  nonNegative(margin, "margin");
  void at;
  const rest = one.profile.rest;
  insist(rest > 1, "there is no standing time to take a second off", "profile");
  const now = outputPerDay(one);
  const quicker = (now * rest) / (rest - 1);
  return round((quicker - now) * days * margin, 0);
}

/** The energy a year of winding takes, in kilowatt hours. */
export function energyAYear(one: Winder, days = 300): number {
  positive(days, "days");
  return round(energyADay(one) * days, 0);
}

/** What that energy costs, in pounds a year. */
export function powerAYear(one: Winder, at = prices(), days = 300): number {
  return round((energyAYear(one, days) * at.power) / 100, 0);
}

/** The cost in a line, for a report. */
export function describeCost(one: Winder, at = prices()): string {
  return (
    `${perTonne(one, at)}p a tonne — ${powerPerTonne(one, at)} power, ` +
    `${ropePerTonne(one, at)} rope, ${menPerTonne(one, at)} men — ` +
    `and a day down is £${aDayDown(at)}`
  );
}
