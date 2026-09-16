/**
 * The wind itself: how it starts, how fast it goes, how it stops, and
 * how long the whole thing takes.
 *
 * A winding cycle is five things end to end. The cage creeps off the
 * keps at walking pace while it clears the shaft top; it accelerates;
 * it runs at full speed for most of the shaft; it decelerates; it
 * creeps the last few metres onto the keps at the other end. Then it
 * stands while the tubs are changed, and none of the arithmetic above
 * matters as much as that standing time does.
 *
 * The thing that surprises people is how little of a wind is spent at
 * full speed in a shallow shaft. At six hundred metres and fifteen
 * metres a second, a third of the wind is acceleration and a third is
 * deceleration — and in a shaft of two hundred metres the cage never
 * reaches full speed at all, so raising the winder's top speed buys
 * nothing whatever.
 */

import { WindingError, insist, nonNegative, positive, within } from "../errors.ts";
import { round, roundDown } from "../units/round.ts";
import { speed as checkSpeed } from "../errors.ts";

/** How a winder is set to work. */
export interface Profile {
  /** The full speed it runs at, in metres a second. */
  readonly full: number;
  /** How hard it accelerates, in metres a second squared. */
  readonly accelerate: number;
  /** How hard it decelerates. */
  readonly decelerate: number;
  /** The speed it creeps at, at each end. */
  readonly creep: number;
  /** How far it creeps, at each end, in metres. */
  readonly creepFor: number;
  /** How long it stands between winds, in seconds. */
  readonly rest: number;
}

/** A profile, checked. */
export function profile(over: Partial<Profile> = {}): Profile {
  const found: Profile = {
    full: over.full ?? 15,
    accelerate: over.accelerate ?? 1,
    decelerate: over.decelerate ?? 1.1,
    creep: over.creep ?? 0.5,
    creepFor: over.creepFor ?? 6,
    rest: over.rest ?? 25,
  };
  checkSpeed(found.full, "full");
  positive(found.full, "full");
  within(found.accelerate, 0.1, 3, "accelerate");
  within(found.decelerate, 0.1, 3, "decelerate");
  within(found.creep, 0, found.full, "creep");
  nonNegative(found.creepFor, "creepFor");
  nonNegative(found.rest, "rest");
  return found;
}

/** The fastest men may be wound at, in metres a second. */
export const MEN_SPEED = 12;

/** And the hardest they may be accelerated. */
export const MEN_ACCELERATION = 0.8;

/** A profile trimmed to what men may be wound at. */
export function forMen(one: Profile, speed = MEN_SPEED, acceleration = MEN_ACCELERATION): Profile {
  return profile({
    ...one,
    full: Math.min(one.full, speed),
    accelerate: Math.min(one.accelerate, acceleration),
    decelerate: Math.min(one.decelerate, acceleration),
    rest: one.rest * 2,
  });
}

/** The distance spent getting up to full speed, in metres. */
export function accelerating(one: Profile): number {
  const from = one.creep;
  return round((one.full * one.full - from * from) / (2 * one.accelerate), 4);
}

/** And getting down from it. */
export function decelerating(one: Profile): number {
  const to = one.creep;
  return round((one.full * one.full - to * to) / (2 * one.decelerate), 4);
}

/** The least distance in which a wind reaches full speed at all, in metres. */
export function needsToReachFull(one: Profile): number {
  return round(accelerating(one) + decelerating(one) + 2 * one.creepFor, 4);
}

/** Whether a wind of a stated length reaches full speed. */
export function reachesFull(one: Profile, distance: number): boolean {
  positive(distance, "distance");
  return distance >= needsToReachFull(one);
}

/**
 * The fastest a wind of a stated length actually gets, in metres a
 * second.
 *
 * The full speed where the shaft is long enough and the peak of a
 * triangle where it is not. It is the number that says whether a faster
 * winder would be worth anything in a given shaft, and the answer in a
 * shallow one is that it would not.
 */
export function topSpeed(one: Profile, distance: number): number {
  return round(peak(one, distance), 4);
}

/**
 * The same, unrounded.
 *
 * Everything downstream squares this and then subtracts it from the
 * distance, so a rounding here comes back as a wind that does not fit
 * its own profile by a millimetre. Round on the way out of the
 * calculation, not on the way through it.
 */
function peak(one: Profile, distance: number): number {
  positive(distance, "distance");
  if (reachesFull(one, distance)) return one.full;
  const running = distance - 2 * one.creepFor;
  insist(running > 0, "that wind is all creep and no wind", "distance");
  const from = one.creep;
  const found = Math.sqrt(
    (2 * one.accelerate * one.decelerate * running + from * from * (one.accelerate + one.decelerate)) /
      (one.accelerate + one.decelerate),
  );
  return Math.min(one.full, found);
}

/**
 * How long a wind of a stated length takes, in seconds.
 *
 * Creep, accelerate, run, decelerate, creep — and then the rest, which
 * is not part of the wind but is part of the cycle and is usually the
 * largest single item in a shallow shaft.
 */
export function windTime(one: Profile, distance: number): number {
  positive(distance, "distance");
  const creeping = one.creep > 0 ? (2 * one.creepFor) / one.creep : 0;
  const top = peak(one, distance);
  const up = (top - one.creep) / one.accelerate;
  const down = (top - one.creep) / one.decelerate;
  const covered = (top * top - one.creep * one.creep) / (2 * one.accelerate) +
    (top * top - one.creep * one.creep) / (2 * one.decelerate);
  const running = distance - 2 * one.creepFor - covered;
  insist(running >= -1e-9, "that wind does not fit its own profile", "distance");
  const flat = running > 0 ? running / top : 0;
  return round(creeping + up + flat + down, 3);
}

/** And the whole cycle, standing time and all. */
export function cycleTime(one: Profile, distance: number): number {
  return round(windTime(one, distance) + one.rest, 3);
}

/** The share of the cycle actually spent moving. */
export function movingShare(one: Profile, distance: number): number {
  const whole = cycleTime(one, distance);
  insist(whole > 0, "that cycle takes no time at all", "distance");
  return round(windTime(one, distance) / whole, 4);
}

/** The share of the wind spent at full speed. */
export function atFullShare(one: Profile, distance: number): number {
  if (!reachesFull(one, distance)) return 0;
  const covered = accelerating(one) + decelerating(one) + 2 * one.creepFor;
  const flat = (distance - covered) / one.full;
  const found = windTime(one, distance);
  insist(found > 0, "that wind takes no time at all", "distance");
  return round(flat / found, 4);
}

/** How many winds an hour that cycle gives. */
export function windsAnHour(one: Profile, distance: number): number {
  const whole = cycleTime(one, distance);
  insist(whole > 0, "that cycle takes no time at all", "distance");
  return round(3600 / whole, 3);
}

/** How much a winder raises in an hour, in tonnes. */
export function tonnesAnHour(one: Profile, distance: number, payload: number, conveyances = 2): number {
  positive(payload, "payload");
  positive(conveyances, "conveyances");
  // A balanced winder raises one conveyance a wind; the other is going
  // down at the same time and is not a second wind.
  return round((windsAnHour(one, distance) * payload) / 1000, 3);
}

/** And in a day, allowing for the shifts it actually winds coal on. */
export function tonnesADay(one: Profile, distance: number, payload: number, hours = 16): number {
  within(hours, 0, 24, "hours");
  return round(tonnesAnHour(one, distance, payload) * hours, 1);
}

/**
 * The full speed a wanted output asks for, in metres a second.
 *
 * Searched upward, because the relation between speed and output is not
 * one anybody can invert on paper: raising the speed shortens the
 * running part of the wind and lengthens the accelerating part, and in
 * a shallow shaft it does nothing at all.
 */
export function speedFor(one: Profile, distance: number, wanted: number, payload: number): number {
  positive(wanted, "wanted");
  for (let at = 1; at <= 25; at += 0.1) {
    const trial = profile({ ...one, full: round(at, 2) });
    if (tonnesAnHour(trial, distance, payload) >= wanted) return round(at, 2);
  }
  throw new WindingError(
    `no speed a winder is allowed raises ${wanted} t/h from ${round(distance, 0)} m in ${round(payload / 1000, 1)} t loads; ` +
      `that wants a larger conveyance or a shorter standing time`,
    "wanted",
  );
}

/**
 * What a second off the standing time is worth, in tonnes an hour.
 *
 * The figure a colliery actually acts on. Winding faster is expensive
 * and mostly impossible; decking faster costs nothing but arrangement,
 * and in a shallow shaft a second saved at the pit top is worth more
 * than a metre a second on the winder.
 */
export function worthOfASecond(one: Profile, distance: number, payload: number): number {
  const now = tonnesAnHour(one, distance, payload);
  const quicker = tonnesAnHour(profile({ ...one, rest: Math.max(0, one.rest - 1) }), distance, payload);
  return round(quicker - now, 4);
}

/** And what a metre a second on the winder is worth, for comparison. */
export function worthOfSpeed(one: Profile, distance: number, payload: number): number {
  const now = tonnesAnHour(one, distance, payload);
  const faster = tonnesAnHour(profile({ ...one, full: Math.min(25, one.full + 1) }), distance, payload);
  return round(faster - now, 4);
}

/** How many men a shift's worth of man-winding will move. */
export function menAnHour(one: Profile, distance: number, cage: number): number {
  positive(cage, "cage");
  return roundDown(windsAnHour(forMen(one), distance) * cage, 0);
}

/** How long it takes to get a whole shift down, in minutes. */
export function shiftDown(one: Profile, distance: number, cage: number, men: number): number {
  positive(men, "men");
  const perHour = menAnHour(one, distance, cage);
  insist(perHour > 0, "that winder moves nobody", "cage");
  return round((men / perHour) * 60, 2);
}

/** The wind described in a line. */
export function describeWind(one: Profile, distance: number): string {
  return (
    `${round(distance, 0)} m in ${windTime(one, distance)} s at up to ${topSpeed(one, distance)} m/s, ` +
    `${cycleTime(one, distance)} s a cycle, ${windsAnHour(one, distance)} winds an hour`
  );
}
