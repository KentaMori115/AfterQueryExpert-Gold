/**
 * The things that stop a wind going wrong, and the one that is designed
 * to break.
 *
 * Everything else in this library is about a winder working. This is
 * about it not working, which is a different discipline and an older
 * one: every device here was invented after an accident and most of
 * them are named after the man who investigated it.
 *
 * The two that matter are the overwind and the overspeed. An overwind
 * is the conveyance going past the landing and into the headgear; an
 * overspeed is it arriving at the landing too fast to stop. Both are
 * the winding engineman's mistake and both are guarded by machinery
 * that does not trust him — which is not an insult to enginemen but an
 * admission that a man who winds four hundred times a shift for thirty
 * years will one day wind four hundred and one.
 */

import { WindingError, insist, nonNegative, positive, within } from "../errors.ts";
import { round, roundUp } from "../units/round.ts";
import { speed as checkSpeed } from "../errors.ts";
import { type Profile } from "../cycle/index.ts";

/** The retardation the arrestor gear in a headgear gives, in metres a second squared. */
export const ARRESTOR = 9.81;

/** The retardation an emergency brake gives on the drum. */
export const EMERGENCY_BRAKE = 2.5;

/** And what the ordinary working brake gives. */
export const WORKING_BRAKE = 1.1;

/**
 * How far a wind runs on after the brake is applied, in metres.
 *
 * At the speed it was doing, with the retardation the brake gives, plus
 * whatever it covered while the brake was making up its mind. The last
 * of those is the one that is left out: a brake takes half a second to
 * apply and at fifteen metres a second that is seven and a half metres
 * of shaft.
 */
export function stoppingDistance(speed: number, retardation = EMERGENCY_BRAKE, delay = 0.5): number {
  checkSpeed(speed, "speed");
  positive(retardation, "retardation");
  nonNegative(delay, "delay");
  return round(speed * delay + (speed * speed) / (2 * retardation), 3);
}

/** How long that takes, in seconds. */
export function stoppingTime(speed: number, retardation = EMERGENCY_BRAKE, delay = 0.5): number {
  checkSpeed(speed, "speed");
  positive(retardation, "retardation");
  nonNegative(delay, "delay");
  return round(delay + speed / retardation, 3);
}

/**
 * The retardation the brake must be set to, given the room it has.
 *
 * The other way round, and the way a colliery actually asks it: the
 * headgear is the height it is, the overwind room is what it is, and
 * the brake has to stop the wind inside it whatever that takes.
 */
export function retardationFor(speed: number, room: number, delay = 0.5): number {
  checkSpeed(speed, "speed");
  positive(room, "room");
  nonNegative(delay, "delay");
  const left = room - speed * delay;
  insist(left > 0, "the wind covers the whole room before the brake even applies", "room");
  return round((speed * speed) / (2 * left), 3);
}

/**
 * The overspeed at which the automatic contrivance must act, as a share
 * of full speed.
 *
 * A tenth above, which is close enough to catch a real overspeed and
 * far enough not to trip on the ordinary overshoot of a hand-driven
 * winder. Below that margin the device is a nuisance and gets
 * disconnected, which is how it comes to be disconnected on the day it
 * was needed.
 */
export const OVERSPEED_MARGIN = 1.1;

/** The speed at which the overspeed gear trips. */
export function tripSpeed(one: Profile, margin = OVERSPEED_MARGIN): number {
  positive(margin, "margin");
  insist(margin > 1, "an overspeed margin of one trips on every wind", "margin");
  return round(one.full * margin, 3);
}

/**
 * The retardation curve the gear watches near the landing, in metres a
 * second.
 *
 * The important half of overspeed protection and the half that came
 * later. A single trip speed catches a winder running away in mid-shaft
 * and does nothing at all about one arriving at the landing at full
 * speed, because full speed is not an overspeed. So the gear carries a
 * curve: at every distance from the landing there is a speed above
 * which the wind cannot be stopped in what is left, and the gear trips
 * on that instead.
 */
export function curveSpeed(toGo: number, retardation = EMERGENCY_BRAKE, delay = 0.5): number {
  nonNegative(toGo, "toGo");
  positive(retardation, "retardation");
  // Solving the stopping distance for the speed, delay and all.
  const a = 1 / (2 * retardation);
  const found = (-delay + Math.sqrt(delay * delay + 4 * a * toGo)) / (2 * a);
  return round(Math.max(0, found), 3);
}

/** Whether a wind at a stated point and speed is inside the curve. */
export function insideCurve(toGo: number, speed: number, retardation = EMERGENCY_BRAKE, delay = 0.5): boolean {
  return speed <= curveSpeed(toGo, retardation, delay);
}

/**
 * The distance from the landing at which the retardation curve first
 * bites, in metres.
 *
 * Where the curve crosses the winder's own full speed. Beyond it the
 * curve is above full speed and does nothing; inside it the curve is
 * the binding limit and the engineman is being told when to brake.
 */
export function curveBegins(one: Profile, retardation = EMERGENCY_BRAKE, delay = 0.5): number {
  return round(stoppingDistance(one.full, retardation, delay), 2);
}

/**
 * The load at which the detaching hook is designed to part, in
 * kilonewtons.
 *
 * The one component of a winding installation that is meant to fail. If
 * a cage is wound into the headgear the rope will not break — a
 * winding rope stands eight times the load — so the cage is pulled into
 * the sheave and then falls the whole depth of the shaft. The detaching
 * hook parts first, at a load well below the rope's, and leaves the
 * cage held on the arrestor gear with the rope going on without it.
 */
export function hookLoad(breakingLoad: number, share = 0.4): number {
  positive(breakingLoad, "breakingLoad");
  within(share, 0.15, 0.7, "share");
  return round(breakingLoad * share, 2);
}

/** Whether the hook will part before the rope does. */
export function hookPartsFirst(breakingLoad: number, hook: number): boolean {
  positive(breakingLoad, "breakingLoad");
  positive(hook, "hook");
  return hook < breakingLoad;
}

/** Whether the hook will hold the ordinary working load. */
export function hookHolds(hook: number, working: number, margin = 2): boolean {
  positive(working, "working");
  positive(margin, "margin");
  return hook >= working * margin;
}

/**
 * The band a detaching hook has to sit in, in kilonewtons.
 *
 * Above twice the working load, so that it does not part on an ordinary
 * wind; below the rope's breaking load, so that it parts before the
 * rope does. On a shallow shaft the band is wide and nobody thinks
 * about it. On a deep one, where the rope's own weight has eaten most
 * of the factor of safety, the band narrows — and it can close
 * altogether, which is a fact about the installation and not about the
 * hook.
 */
export function hookBand(breakingLoad: number, working: number, margin = 2): { readonly low: number; readonly high: number } {
  positive(breakingLoad, "breakingLoad");
  positive(working, "working");
  const low = round(working * margin, 2);
  insist(low < breakingLoad, "there is no load at which a hook both holds the wind and parts before the rope", "working");
  return { low, high: round(breakingLoad, 2) };
}

/** The keps: the catches the conveyance rests on at a landing. */
export interface Keps {
  /** What they will hold, in kilonewtons. */
  readonly holds: number;
  /** How long they take to withdraw, in seconds. */
  readonly withdraw: number;
}

/** Keps, checked. */
export function keps(holds = 400, withdraw = 3): Keps {
  positive(holds, "holds");
  positive(withdraw, "withdraw");
  return { holds, withdraw };
}

/** Whether the keps will hold the conveyance standing on them. */
export function kepsHold(one: Keps, load: number): boolean {
  positive(load, "load");
  return one.holds >= load;
}

/** How much of the standing time the keps account for, as a share. */
export function kepsShare(one: Keps, rest: number): number {
  positive(rest, "rest");
  return round((2 * one.withdraw) / rest, 4);
}

/**
 * How often a winding rope must be examined, in days.
 *
 * Daily for the whole length that passes over the sheave, and a
 * complete examination at longer intervals. The daily one is not a
 * formality: a rope that has started to break wires breaks more of them
 * every day, and the interval between the first broken wire and the
 * condemning number is measured in weeks.
 */
export const EXAMINED_EVERY = 1;

/** How often it must be capped anew, in months. */
export const RECAPPED_EVERY = 6;

/** Whether an inspection regime meets what the rules ask. */
export function inspected(daily: number, capping: number): boolean {
  positive(daily, "daily");
  positive(capping, "capping");
  return daily <= EXAMINED_EVERY && capping <= RECAPPED_EVERY;
}

/** The safety arrangements in a line, for a report. */
export function describeGear(one: Profile, room: number, breaking: number, working: number): string {
  return (
    `trips at ${tripSpeed(one)} m/s, curve begins ${curveBegins(one)} m out, ` +
    `wants ${retardationFor(one.full, room)} m/s² to stop in ${round(room, 0)} m, ` +
    `hook between ${hookBand(breaking, working).low} and ${hookBand(breaking, working).high} kN`
  );
}

/** The error this module throws, for a caller that wants to catch it. */
export function refuse(says: string, quantity: string): never {
  throw new WindingError(says, quantity);
}
