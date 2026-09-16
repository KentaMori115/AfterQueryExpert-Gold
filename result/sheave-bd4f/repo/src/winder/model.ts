/**
 * A whole winding installation, and the figures a colliery is judged
 * on.
 *
 * Every other module here answers one question about one part. This is
 * where they meet, and where the answers stop agreeing: a rope big
 * enough for the depth wants a drum too big for the engine house, a
 * cycle fast enough for the output wants a motor the substation will
 * not carry, and a conveyance large enough to make the cycle worth
 * having will not go down the shaft.
 *
 * The whole art of winding is in which of those to give way on, and the
 * answer has always been the same one: the shaft was sunk first and
 * everything else has to fit down it.
 */

import { insist, nonNegative, positive, within } from "../errors.ts";
import { round } from "../units/round.ts";
import { weightOf } from "../units/measure.ts";
import {
  type Hang,
  DEEPEST_FACTOR,
  breakingLoad,
  bouncePeriod,
  factorAt,
  factorFor,
  goesSlack,
  hang,
  massPerMetre,
  peakPull,
  shockFactor,
  staticRopeLoad,
  wholeStretch,
  type Rope,
} from "../rope/index.ts";
import { EMERGENCY_BRAKE } from "../safety/index.ts";
import { type Shaft, ropeLength } from "../shaft/index.ts";
import { type Drum, type Koepe } from "../drum/index.ts";
import { type Conveyance, gross } from "../cage/index.ts";
import { type Profile, cycleTime, tonnesADay, tonnesAnHour, windTime, windsAnHour } from "../cycle/index.ts";
import { type Duty, duty, energyPerTonne, energyPerWind, motorFor, peakPower, rmsPower, swing } from "../power/index.ts";

/** How the rope is driven. */
export type Drive =
  | { readonly kind: "drum"; readonly drum: Drum }
  | { readonly kind: "koepe"; readonly koepe: Koepe };

/** A winding installation, as built and as worked. */
export interface Winder {
  /** What it is called. */
  readonly name: string;
  /** The shaft it works in. */
  readonly shaft: Shaft;
  /** The rope it hangs on. */
  readonly rope: Rope;
  /** How many ropes there are. */
  readonly ropes: number;
  /** How the rope is driven. */
  readonly drive: Drive;
  /** What goes up. */
  readonly rising: Conveyance;
  /** What comes down. */
  readonly falling: Conveyance;
  /** The balance rope hung beneath, in kilograms a metre. */
  readonly balance: number;
  /** How it is set to work. */
  readonly profile: Profile;
  /** How many hours a day it winds coal. */
  readonly hours: number;
}

/** A winder, checked. */
export function winder(over: Partial<Winder> & Pick<Winder, "name" | "shaft" | "rope" | "drive" | "rising" | "falling" | "profile">): Winder {
  const found: Winder = {
    name: over.name,
    shaft: over.shaft,
    rope: over.rope,
    ropes: over.ropes ?? 1,
    drive: over.drive,
    rising: over.rising,
    falling: over.falling,
    balance: over.balance ?? 0,
    profile: over.profile,
    hours: over.hours ?? 16,
  };
  insist(found.name.trim().length > 0, "a winder has to be called something", "name");
  within(found.ropes, 1, 6, "ropes");
  nonNegative(found.balance, "balance");
  within(found.hours, 0, 24, "hours");
  return found;
}

/** The wind, from the lowest inset to the bank, in metres. */
export function windLength(one: Winder): number {
  return one.shaft.depth;
}

/** The rope that has to be on the machine, in metres. */
export function ropeWanted(one: Winder): number {
  return ropeLength(one.shaft);
}

/** The duty the winder's own arrangement makes. */
export function dutyOf(one: Winder): Duty {
  const radius = one.drive.kind === "drum" ? one.drive.drum.diameter / 2 : one.drive.koepe.diameter / 2;
  return duty({
    rising: one.rising,
    falling: one.falling,
    rope: one.rope,
    ropes: one.ropes,
    balance: one.balance,
    depth: windLength(one),
    radius,
    inertia: inertiaOf(one),
  });
}

/**
 * What the rotating parts weigh, referred to the rope, in kilograms.
 *
 * A drum is a steel cylinder and weighs what one weighs; the motor and
 * the gearing, referred through the ratio, weigh about as much again.
 * It is the item that is left out of a first calculation and it is a
 * third of the accelerating force on a large winder.
 */
export function inertiaOf(one: Winder): number {
  if (one.drive.kind === "koepe") {
    const wheel = one.drive.koepe;
    return round(2400 * wheel.diameter * wheel.diameter, 0);
  }
  const barrel = one.drive.drum;
  return round(1800 * barrel.diameter * barrel.diameter * barrel.width, 0);
}

/** What hangs on the rope when the rising conveyance is at the bottom, in kilonewtons. */
export function hangingLoad(one: Winder): number {
  return round(weightOf(gross(one.rising)) + staticRopeLoad(one.rope, windLength(one)) * one.ropes, 4);
}

/** What the worst rope of the set carries, in kilonewtons. */
export function worstRopeLoad(one: Winder): number {
  return round(hangingLoad(one) * worstShare(one.ropes), 4);
}

/**
 * How unevenly the ropes of a multi-rope winder share the load.
 *
 * Four ropes over one wheel are never exactly the same length, and the
 * short one takes more than its share until it stretches. A tenth over
 * the mean is the design allowance, and the factor of safety is worked
 * on the worst rope rather than on the mean — which is the whole point
 * of having an allowance at all.
 *
 * It does not apply to a single rope, and applying it there would not
 * be conservatism but arithmetic: there is nothing for one rope to be
 * unequal with.
 */
export const ROPE_SHARE = 1.1;

/** The share of the load the worst rope of a set carries. */
export function worstShare(ropes: number): number {
  positive(ropes, "ropes");
  return ropes <= 1 ? 1 : round(ROPE_SHARE / ropes, 5);
}

/**
 * The factor of safety the rope is working at.
 *
 * On the worst rope of a set, not on the mean. A four-rope winder
 * carries a quarter of the load on each rope and is judged on a
 * quarter-and-a-tenth, which is the difference between a rope inside
 * the rule and one outside it.
 */
export function factor(one: Winder): number {
  return factorAt(one.rope, windLength(one), worstShare(one.ropes) * weightOf(gross(one.rising)));
}

/** And the one the depth demands. */
export function factorWanted(one: Winder): number {
  return factorFor(windLength(one));
}

/** Whether the rope is strong enough for the shaft it is in. */
export function ropeStrongEnough(one: Winder): boolean {
  return factor(one) >= factorWanted(one);
}

/** How long a wind takes, in seconds. */
export function windLasts(one: Winder): number {
  return windTime(one.profile, windLength(one));
}

/** And the whole cycle. */
export function cycleLasts(one: Winder): number {
  return cycleTime(one.profile, windLength(one));
}

/** How many winds an hour it makes. */
export function windsPerHour(one: Winder): number {
  return windsAnHour(one.profile, windLength(one));
}

/** What it raises in an hour, in tonnes. */
export function outputPerHour(one: Winder): number {
  return tonnesAnHour(one.profile, windLength(one), one.rising.payload);
}

/** And in a day, over the hours it actually winds coal. */
export function outputPerDay(one: Winder): number {
  return tonnesADay(one.profile, windLength(one), one.rising.payload, one.hours);
}

/** The peak power it takes, in kilowatts. */
export function peak(one: Winder): number {
  return peakPower(dutyOf(one), one.profile);
}

/** The root-mean-square power over the cycle. */
export function rms(one: Winder): number {
  return rmsPower(dutyOf(one), one.profile);
}

/** The motor it wants. */
export function motor(one: Winder): number {
  return motorFor(dutyOf(one), one.profile);
}

/** How far the out-of-balance swings across a wind, in kilonewtons. */
export function balanceSwing(one: Winder): number {
  return swing(dutyOf(one));
}

/** The energy a wind takes, in kilowatt hours. */
export function energy(one: Winder): number {
  return energyPerWind(dutyOf(one));
}

/** And a tonne raised. */
export function energyATonne(one: Winder): number {
  return energyPerTonne(dutyOf(one));
}

/** The energy a day of winding takes, in kilowatt hours. */
export function energyADay(one: Winder): number {
  return round(energyATonne(one) * outputPerDay(one), 1);
}

/**
 * How much of the winder's strength is used lifting itself, as a share.
 *
 * The rope and the tare over everything hoisted. On a deep cage
 * installation it is four fifths, which is to say that four winds in
 * every five are spent lifting steel and one is spent lifting coal.
 */
export function deadShare(one: Winder): number {
  const whole = gross(one.rising) + massPerMetre(one.rope) * one.ropes * windLength(one);
  insist(whole > 0, "that winder hoists nothing at all", "rising");
  return round((whole - one.rising.payload) / whole, 4);
}

/** The margin left on the rope, as a share of its breaking load. */
export function ropeMargin(one: Winder): number {
  const breaking = breakingLoad(one.rope);
  insist(breaking > 0, "that rope stands nothing", "rope");
  return round(1 - worstRopeLoad(one) / breaking, 4);
}

/** The winder in a line, for the top of a report. */
export function describeWinder(one: Winder): string {
  return (
    `${one.name}: ${one.drive.kind} winding ${round(one.rising.payload / 1000, 1)} t ` +
    `from ${windLength(one)} m in ${windLasts(one)} s, ` +
    `${outputPerDay(one)} t/d on a ${motor(one)} kW motor`
  );
}

/** The drum, if it has one, or a refusal saying it has not. */
export function drumOf(one: Winder): Drum {
  insist(one.drive.kind === "drum", `${one.name} is a friction winder and has no drum`, "drive");
  return (one.drive as { readonly drum: Drum }).drum;
}

/** The wheel, if it has one. */
export function wheelOf(one: Winder): Koepe {
  insist(one.drive.kind === "koepe", `${one.name} is a drum winder and has no friction wheel`, "drive");
  return (one.drive as { readonly koepe: Koepe }).koepe;
}

/** The tonnes a year at the present rate, allowing for days not worked. */
export function outputPerYear(one: Winder, days = 300): number {
  positive(days, "days");
  return round(outputPerDay(one) * days, 0);
}

/**
 * The rope hanging in the shaft with the rising conveyance a stated
 * height above the lowest inset, in metres.
 *
 * The rope is measured from the sheave and not from the bank, so a
 * conveyance standing at the bank still has the headgear's worth of
 * rope above it and is not on a spring of no length. The balance rope
 * under it is as long as the conveyance is high, which is what a
 * balance rope is for and is why the static pull hardly moves across a
 * wind while the mass that swings on it moves a great deal.
 */
export function hangAt(one: Winder, up: number): Hang {
  nonNegative(up, "up");
  within(up, 0, windLength(one), "up");
  return hang({
    rope: one.rope,
    length: ropeWanted(one) - up,
    ropes: one.ropes,
    carried: gross(one.rising),
    balance: one.balance * up,
  });
}

/** How far the rope has stretched at that point in the wind, in metres. */
export function stretchAt(one: Winder, up: number): number {
  return wholeStretch(hangAt(one, up));
}

/** The period it bounces at there, in seconds. */
export function bounceAt(one: Winder, up: number): number {
  return bouncePeriod(hangAt(one, up));
}

/**
 * The factor of safety the rope works at when a rising wind is stopped
 * there.
 *
 * The set's factor, cut by the same unevenness the static factor is
 * cut by: the worst rope of a set carries more than an even share, so
 * it reaches its own limit before the set reaches the set's. A single
 * rope is cut by nothing, there being nothing for it to be unequal
 * with.
 */
export function shockFactorAt(one: Winder, up: number, retardation = EMERGENCY_BRAKE): number {
  const uneven = worstShare(one.ropes) * one.ropes;
  insist(uneven > 0, "that winder has no ropes on it", "ropes");
  return round(shockFactor(hangAt(one, up), retardation) / uneven, 3);
}

/** Whether stopping a descending wind there leaves the rope slack. */
export function slackAt(one: Winder, up: number, retardation = EMERGENCY_BRAKE): boolean {
  return goesSlack(hangAt(one, up), retardation);
}

/** A point in the wind, and what the rope is working at there. */
export interface Worst {
  /** How far above the lowest inset it is, in metres. */
  readonly up: number;
  /** The factor of safety found there. */
  readonly factor: number;
}

/**
 * Where in the wind an emergency stop is worst, and what it comes to.
 *
 * Walked in whole metres from the lowest inset to the bank, because the
 * answer is not at the end anybody expects and is not always at the
 * same end. On a winder with no balance rope the worst is at the
 * bottom, where the winding rope's own weight is all in the shaft. On a
 * balanced one it is at the top, because the balance rope's whole mass
 * swings with the conveyance while only a third of the winding rope's
 * does — so the mass being retarded grows as the wind rises while the
 * load hanging stays where it was.
 */
export function worstShock(one: Winder, retardation = EMERGENCY_BRAKE): Worst {
  const wind = Math.floor(windLength(one));
  let where = 0;
  let most = peakPull(hangAt(one, 0), retardation);
  for (let up = 1; up <= wind; up += 1) {
    const found = peakPull(hangAt(one, up), retardation);
    if (found > most) {
      most = found;
      where = up;
    }
  }
  return { up: where, factor: shockFactorAt(one, where, retardation) };
}

/** Whether the rope stands an emergency stop anywhere in the wind. */
export function standsAStop(one: Winder, retardation = EMERGENCY_BRAKE): boolean {
  return worstShock(one, retardation).factor >= DEEPEST_FACTOR;
}
