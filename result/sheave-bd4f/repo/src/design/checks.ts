/**
 * The figures a winding installation is signed off against.
 *
 * A design check is not an audit. The audit asks what is wrong; this
 * asks whether each figure is inside the band it was designed to be
 * inside, and reports every one of them whether it passes or not — so
 * that an installation which passes everything by a hair reads
 * differently from one which passes everything comfortably, and so that
 * the figure nobody was worried about is on the same sheet as the one
 * everybody was.
 *
 * Every band here is a number somebody could argue with, and every one
 * of them can be moved by the caller. What cannot be moved is that they
 * are all checked, every time.
 */

import { WindingError, insist, positive } from "../errors.ts";
import { round } from "../units/round.ts";
import { weightOf } from "../units/measure.ts";
import { DEEPEST_FACTOR, LEAST_RATIO, breakingLoad, factorFor, lifeIn, ratioOf } from "../rope/index.ts";
import { MOST_FLEET, capacity, fleetAngle } from "../drum/cylindrical.ts";
import { MOST_SWAY, SHOE_SPAN, guides, lateralLoad, sway } from "../shaft/guides.ts";
import { overwindRoom, stoppableFrom, sumpFor, widestConveyance } from "../shaft/shaft.ts";
import { MEN_SPEED, movingShare } from "../cycle/index.ts";
import { gross, usefulFraction } from "../cage/index.ts";
import { overloadRatio } from "../power/index.ts";
import {
  type Winder,
  balanceSwing,
  cycleLasts,
  deadShare,
  drumOf,
  dutyOf,
  factor,
  hangingLoad,
  motor,
  peak,
  ropeWanted,
  windLength,
  worstShock,
} from "../winder/model.ts";

/** One figure and the band it was meant to be in. */
export interface Check {
  /** What is being checked. */
  readonly name: string;
  /** What was found. */
  readonly found: number;
  /** The bottom of the band, or nothing if there is no bottom. */
  readonly low: number | undefined;
  /** The top of it, or nothing if there is no top. */
  readonly high: number | undefined;
  /** Whether it is inside. */
  readonly met: boolean;
  /** What the figure means, in a few words. */
  readonly says: string;
}

function check(name: string, found: number, low: number | undefined, high: number | undefined, says: string): Check {
  const met = (low === undefined || found >= low) && (high === undefined || found <= high);
  return { name, found: round(found, 4), low, high, met, says };
}

/** What a design says an installation should be inside. */
export interface Bands {
  /** The least drum-to-rope ratio. */
  readonly ratio: number;
  /** The greatest fleet angle, in degrees. */
  readonly fleet: number;
  /** The greatest sway, in metres. */
  readonly sway: number;
  /** The least rope life, in winds. */
  readonly life: number;
  /** The greatest share of the cycle that may be standing time. */
  readonly standing: number;
  /** The greatest overload the drive must carry. */
  readonly overload: number;
  /** The greatest out-of-balance swing, in kilonewtons. */
  readonly swing: number;
  /** The greatest share of what is hoisted that may be dead weight. */
  readonly dead: number;
  /** The least factor of safety the rope may work at while a wind is stopped. */
  readonly stop: number;
}

/** The ordinary bands, which a caller may replace one at a time. */
export function bands(over: Partial<Bands> = {}): Bands {
  return {
    ratio: over.ratio ?? LEAST_RATIO,
    fleet: over.fleet ?? MOST_FLEET,
    sway: over.sway ?? MOST_SWAY,
    life: over.life ?? 300_000,
    standing: over.standing ?? 0.35,
    overload: over.overload ?? 2.5,
    swing: over.swing ?? 40,
    dead: over.dead ?? 0.75,
    stop: over.stop ?? DEEPEST_FACTOR,
  };
}

/** Every check, in the order a signing-off engineer would want them. */
export function checks(one: Winder, want = bands()): Check[] {
  const isDrum = one.drive.kind === "drum";
  const barrel = isDrum ? drumOf(one) : undefined;
  const lateral = lateralLoad(gross(one.rising));
  const guided = guides("rope", 4, 6, 90);
  return [
    check("factor", factor(one), factorFor(windLength(one)), undefined, "the factor of safety the rope works at"),
    check(
      "ratio",
      barrel === undefined ? want.ratio : ratioOf(one.rope, barrel.diameter),
      want.ratio,
      undefined,
      "the drum diameter over the rope diameter",
    ),
    check(
      "fleet",
      barrel === undefined ? 0 : fleetAngle(barrel),
      undefined,
      want.fleet,
      "how far the rope leans running onto the drum, in degrees",
    ),
    check(
      "capacity",
      barrel === undefined ? ropeWanted(one) : capacity(barrel, one.rope),
      ropeWanted(one),
      undefined,
      "the rope the drum holds against the rope the wind wants, in metres",
    ),
    check(
      "life",
      barrel === undefined ? want.life : lifeIn(one.rope, barrel.diameter),
      want.life,
      undefined,
      "the winds the rope may be expected to give",
    ),
    check("sway", sway(guided, SHOE_SPAN, lateral), undefined, want.sway, "how far the conveyance moves sideways, in metres"),
    check(
      "conveyance",
      one.rising.width,
      undefined,
      widestConveyance(one.shaft),
      "the conveyance width against what the shaft takes, in metres",
    ),
    check("sump", one.shaft.sump, sumpFor(one.profile.full), undefined, "the sump against an underwind at full speed, in metres"),
    check(
      "overwind",
      stoppableFrom(one.shaft),
      one.profile.full,
      undefined,
      "the speed the headgear arrests against the speed wound at",
    ),
    check("headroom", overwindRoom(one.shaft), 10, undefined, "the room above the bank, in metres"),
    check(
      "standing",
      1 - movingShare(one.profile, windLength(one)),
      undefined,
      want.standing,
      "the share of the cycle spent standing at the landings",
    ),
    check("overload", overloadRatio(dutyOf(one), one.profile), undefined, want.overload, "the peak power over the r.m.s."),
    check("swing", balanceSwing(one), undefined, want.swing, "how far the out-of-balance moves across a wind, in kilonewtons"),
    check("dead", deadShare(one), undefined, want.dead, "the share of what is hoisted that is not coal"),
    check(
      "useful",
      usefulFraction(one.rising),
      1 - want.dead,
      undefined,
      "the share of the conveyance's gross weight that is paid for",
    ),
    check(
      "margin",
      1 - hangingLoad(one) / (breakingLoad(one.rope) * one.ropes),
      0.5,
      undefined,
      "the share of the rope's breaking load still unused",
    ),
    check("men", one.profile.full, undefined, MEN_SPEED * 2, "the winding speed against what men may be wound at"),
    check(
      "creep",
      one.profile.creepFor,
      3,
      12,
      "how far the conveyance creeps on and off the keps, in metres",
    ),
    check(
      "stop",
      worstShock(one).factor,
      want.stop,
      undefined,
      "the factor the rope works at when an emergency stop is worst",
    ),
    check(
      "acceleration",
      Math.max(one.profile.accelerate, one.profile.decelerate),
      undefined,
      1.5,
      "the hardest the conveyance is accelerated, in metres a second squared",
    ),
  ];
}

/** Only the checks that were not met. */
export function failed(found: readonly Check[]): Check[] {
  return found.filter((each) => !each.met);
}

/** Whether every check was met. */
export function meetsDesign(one: Winder, want = bands()): boolean {
  return failed(checks(one, want)).length === 0;
}

/**
 * How much room a check has, as a share of its band.
 *
 * Zero is exactly on the limit and one is at the far end of the band
 * from it. It is what turns a page of passes into a ranking, and the
 * check with the least room is the one that decides what the
 * installation can be pushed to.
 */
export function room(one: Check): number {
  if (!one.met) return 0;
  if (one.low !== undefined && one.high !== undefined) {
    const width = one.high - one.low;
    insist(width > 0, `${one.name} has a band with no width`, one.name);
    return round(Math.min(one.found - one.low, one.high - one.found) / (width / 2), 4);
  }
  if (one.high !== undefined) {
    if (one.high === 0) return one.found === 0 ? 1 : 0;
    return round(Math.max(0, (one.high - one.found) / Math.abs(one.high)), 4);
  }
  if (one.low !== undefined && one.low !== 0) {
    return round(Math.max(0, (one.found - one.low) / Math.abs(one.low)), 4);
  }
  return round(Math.max(0, Math.min(1, one.found)), 4);
}

/** The check with the least room in it, which is what limits the installation. */
export function tightest(one: Winder, want = bands()): Check {
  const all = checks(one, want);
  let best: Check | undefined;
  for (const each of all) if (best === undefined || room(each) < room(best)) best = each;
  if (best === undefined) throw new WindingError("there are no checks to rank", "checks");
  return best;
}

/** A check written out in a line. */
export function describeCheck(one: Check): string {
  const band =
    one.low !== undefined && one.high !== undefined
      ? `${one.low} to ${one.high}`
      : one.high !== undefined
        ? `at most ${one.high}`
        : one.low !== undefined
          ? `at least ${one.low}`
          : "no band";
  return `${one.met ? "met " : "MISSED"} ${one.name}: ${one.found} (${band}) — ${one.says}`;
}

/** The peak power and motor a design asks for, for the head of a sheet. */
export function ratings(one: Winder): { readonly peak: number; readonly motor: number; readonly cycle: number } {
  positive(motor(one), "motor");
  return { peak: peak(one), motor: motor(one), cycle: cycleLasts(one) };
}

/** What the design's own hanging load comes to, in kilonewtons. */
export function designLoad(one: Winder): number {
  return round(weightOf(gross(one.rising)), 4);
}
