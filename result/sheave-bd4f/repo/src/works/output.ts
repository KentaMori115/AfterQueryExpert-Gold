/**
 * The colliery above the shaft, and why the winder is rarely the thing
 * that limits it.
 *
 * A winder that raises six hundred tonnes an hour is worth nothing if
 * the pit bottom fills two hundred, and worth nothing again if the
 * screens above take four hundred. The whole of a colliery's output is
 * set by whichever of half a dozen links is shortest, and it is almost
 * never the one anybody has spent money on — because the money went to
 * the link that was shortest last time.
 *
 * This module puts the links on one sheet. It is the least glamorous
 * arithmetic in the library and it is the arithmetic that decides what
 * the pit actually sends out.
 */

import { insist, count, nonNegative, positive, within } from "../errors.ts";
import { round, roundDown } from "../units/round.ts";
import { type Winder, outputPerDay, outputPerHour, windsPerHour } from "../winder/index.ts";

/** A link in the chain from the face to the wagon. */
export interface Link {
  /** What it is called. */
  readonly name: string;
  /** What it will pass, in tonnes an hour. */
  readonly capacity: number;
  /** How many hours a day it works. */
  readonly hours: number;
}

/** A link, checked. */
export function link(name: string, capacity: number, hours = 16): Link {
  insist(name.trim().length > 0, "a link has to be called something", "name");
  positive(capacity, "capacity");
  within(hours, 0, 24, "hours");
  return { name: name.trim(), capacity, hours };
}

/** What a link passes in a day, in tonnes. */
export function aDay(one: Link): number {
  return round(one.capacity * one.hours, 1);
}

/** The winder as a link in the same chain. */
export function asLink(one: Winder): Link {
  return link(one.name, outputPerHour(one), one.hours);
}

/**
 * The shortest link, which is what the colliery actually makes.
 *
 * Compared on the daily figure and not the hourly one, because a link
 * that works round the clock at half the rate passes more than one that
 * works a single shift at twice it — and the winder is nearly always
 * the link that works the fewest hours.
 */
export function shortest(chain: readonly Link[]): Link {
  insist(chain.length > 0, "a chain with no links in it passes nothing", "chain");
  let best = chain[0] as Link;
  for (const each of chain) if (aDay(each) < aDay(best)) best = each;
  return best;
}

/** What the whole chain passes in a day, which is what its shortest link passes. */
export function chainOutput(chain: readonly Link[]): number {
  return aDay(shortest(chain));
}

/** How much spare each link has over the shortest, as a share. */
export function spare(chain: readonly Link[]): Readonly<Record<string, number>> {
  const least = aDay(shortest(chain));
  insist(least > 0, "the shortest link passes nothing", "chain");
  const out: Record<string, number> = {};
  for (const each of chain) out[each.name] = round(aDay(each) / least - 1, 4);
  return out;
}

/**
 * What lengthening the shortest link is worth, in tonnes a day.
 *
 * Nothing at all beyond the point where the second shortest becomes the
 * shortest — which is the fact this whole module exists to make
 * obvious, and the one every capital scheme that ever overran was
 * written without.
 */
export function worthOfLengthening(chain: readonly Link[], by: number): number {
  within(by, 0, 10, "by");
  const least = shortest(chain);
  const improved = chain.map((each) =>
    each.name === least.name ? link(each.name, each.capacity * (1 + by), each.hours) : each,
  );
  return round(chainOutput(improved) - chainOutput(chain), 1);
}

/** How much of a lengthening is wasted because another link then binds. */
export function wastedLengthening(chain: readonly Link[], by: number): number {
  const least = shortest(chain);
  const whole = round(aDay(least) * by, 1);
  const got = worthOfLengthening(chain, by);
  insist(whole > 0, "that link passes nothing to lengthen", "chain");
  return round(1 - got / whole, 4);
}

/**
 * The bunker a colliery wants between two links, in tonnes.
 *
 * A winder works in bursts of a hundred and twenty seconds and the
 * screens above work continuously, so something has to stand between
 * them or the screens run empty for half of every cycle. Ten minutes of
 * the smaller rate is the usual figure and it is not a large bunker;
 * what makes bunkers large is not the cycle but the shift change.
 */
export function bunkerFor(one: Winder, minutes = 10): number {
  positive(minutes, "minutes");
  return round((outputPerHour(one) * minutes) / 60, 1);
}

/** The bunker a shift change wants, which is a great deal larger. */
export function shiftBunker(one: Winder, minutes = 45): number {
  return bunkerFor(one, minutes);
}

/** How many tubs or skips an hour arrive at the bank. */
export function arrivalsAnHour(one: Winder): number {
  return round(windsPerHour(one), 2);
}

/** How long the men at the bank have between arrivals, in seconds. */
export function betweenArrivals(one: Winder): number {
  const perHour = arrivalsAnHour(one);
  insist(perHour > 0, "nothing arrives at that bank", "profile");
  return round(3600 / perHour, 2);
}

/**
 * How many men a shift's winding takes off the coal-winding day.
 *
 * A colliery that winds men in the same shaft as its coal loses the
 * time twice: once getting them down and once getting them up, and
 * both at the slower speed men are wound at. On a single-shaft pit it
 * is two hours out of sixteen, which is an eighth of the output nobody
 * puts on the sheet.
 */
export function manWindingHours(one: Winder, men: number, cage: number): number {
  positive(men, "men");
  positive(cage, "cage");
  const perWind = cage;
  const winds = Math.ceil(men / perWind);
  // Man-winding is a slower cycle and it happens twice a shift.
  const each = 3600 / windsPerHour(one) * 1.6;
  return round((2 * winds * each) / 3600, 3);
}

/** What that costs in coal, in tonnes a day. */
export function manWindingCosts(one: Winder, men: number, cage: number): number {
  const hours = manWindingHours(one, men, cage);
  return round(outputPerHour(one) * hours, 1);
}

/** The output left after the men have been wound. */
export function afterManWinding(one: Winder, men: number, cage: number): number {
  const left = outputPerDay(one) - manWindingCosts(one, men, cage);
  insist(left > 0, "winding the men takes the whole day", "men");
  return round(left, 1);
}

/**
 * How many wagons a day's output fills.
 *
 * Twenty-one tonnes to a wagon, and they have to be there. A colliery's
 * stocking ground exists because the railway does not deliver empties
 * evenly, and the size of it is the number of days the pit can go on
 * winding with no wagons at all.
 */
export function wagonsADay(tonnes: number, aWagon = 21): number {
  positive(tonnes, "tonnes");
  positive(aWagon, "aWagon");
  return Math.ceil(tonnes / aWagon);
}

/** How long a stocking ground of a stated size lasts, in days. */
export function stockingDays(ground: number, tonnes: number): number {
  nonNegative(ground, "ground");
  positive(tonnes, "tonnes");
  return round(ground / tonnes, 2);
}

/** How many shifts a stated output takes at a stated rate. */
export function shiftsFor(tonnes: number, one: Winder, hoursAShift = 7.5): number {
  positive(tonnes, "tonnes");
  positive(hoursAShift, "hoursAShift");
  const perShift = outputPerHour(one) * hoursAShift;
  insist(perShift > 0, "that winder raises nothing in a shift", "profile");
  return round(tonnes / perShift, 2);
}

/** How many whole shifts, which is what a colliery actually works. */
export function wholeShifts(tonnes: number, one: Winder, hoursAShift = 7.5): number {
  return Math.ceil(shiftsFor(tonnes, one, hoursAShift));
}

/** The chain in a line, for a report. */
export function describeChain(chain: readonly Link[]): string {
  const least = shortest(chain);
  return `${chainOutput(chain)} t/d, held by the ${least.name} at ${least.capacity} t/h for ${least.hours} h`;
}

/** How many links are within a stated share of being the shortest. */
export function closeBehind(chain: readonly Link[], within0 = 0.15): number {
  const found = spare(chain);
  return count(Object.values(found).filter((each) => each <= within0).length, "links");
}

/** The daily output rounded down to whole wagons, which is what is despatched. */
export function despatched(tonnes: number, aWagon = 21): number {
  return roundDown(wagonsADay(tonnes, aWagon) * aWagon - aWagon, 0);
}
