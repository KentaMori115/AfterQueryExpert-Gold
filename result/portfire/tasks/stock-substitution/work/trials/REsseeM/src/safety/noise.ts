import type { Calibre } from "../catalog/calibre.js";
import type { Effect } from "../catalog/effect.js";
import { calibreOf, isAerial, isGround } from "../catalog/effect.js";
import { DiagnosticBag } from "../core/diagnostic.js";
import { clamp } from "../core/numeric.js";
import { formatShowTime } from "../core/timecode.js";
import { ms, raw } from "../core/units.js";
import type { Metres } from "../core/units.js";
import type { QuantisedSchedule } from "../timeline/quantise.js";
import type { Schedule } from "../timeline/schedule.js";
import { distanceToBoundary, positionPoint } from "./site.js";
import type { Boundary } from "./site.js";
import type { Rig } from "../rig/rig.js";

/**
 * How loud it is at the nearest house.
 *
 * Noise is what actually stops a display happening again. A separation
 * distance keeps people safe and a noise limit keeps the licence, and the
 * second one is the one that gets the complaint letter. The number a local
 * authority writes into a licence is a peak level at the nearest noise
 * sensitive property, so that is what this computes.
 *
 * The model is a point source with spherical spreading and no ground effect,
 * which overestimates at long range and is the right way to be wrong. Real
 * propagation on a still night carries further than this predicts, and a
 * prediction that says a show is quieter than it is has no value at all.
 */

/**
 * Sound pressure level at ten metres, in decibels, by what the effect is.
 * Measured figures vary by a good ten decibels between manufacturers, so these
 * are the loud end of the usual range.
 */
const REFERENCE_DISTANCE = 10;

export interface NoiseSource {
  readonly effectId: string;
  readonly levelAtTen: number;
}

export function levelAtTenFor(effect: Effect): number {
  if (isGround(effect)) {
    return 95;
  }
  const size = calibreOf(effect);
  const bore = size === undefined ? 50 : raw(size.size);
  // A break gets louder roughly with the cube root of the charge, and charge
  // goes with the bore cubed, so the level rises about linearly with bore.
  const base = 110 + (bore - 50) * 0.09;
  if (isAerial(effect) && effect.breakStyle === "salute") {
    // A salute is a report rather than a break, and it is a different animal.
    return base + 12;
  }
  return base;
}

/** Level at a distance, spherical spreading from the ten metre reference. */
export function levelAt(levelAtTen: number, distance: Metres): number {
  const metres = Math.max(1, raw(distance));
  return levelAtTen - 20 * Math.log10(metres / REFERENCE_DISTANCE);
}

/** Two sources at once add on an energy basis, not by adding decibels. */
export function combineLevels(levels: readonly number[]): number {
  if (levels.length === 0) {
    return 0;
  }
  const energy = levels.reduce((total, level) => total + 10 ** (level / 10), 0);
  return 10 * Math.log10(energy);
}

export interface NoiseContext {
  readonly rig: Rig;
  /** The nearest noise sensitive property, as a boundary to measure to. */
  readonly sensitive: Boundary;
  /** Peak level the licence allows, in decibels. */
  readonly limit?: number;
}

export interface NoiseFinding {
  readonly effectId: string;
  readonly position: string;
  readonly distance: Metres;
  readonly level: number;
}

export function noiseFindings(
  schedule: Schedule | QuantisedSchedule,
  context: NoiseContext,
): NoiseFinding[] {
  const worst = new Map<string, NoiseFinding>();
  for (const event of schedule.events) {
    const distance = distanceFrom(event.position, context);
    if (distance === undefined) {
      continue;
    }
    const level = levelAt(levelAtTenFor(event.effect), distance);
    const key = `${event.position}|${event.effectId}`;
    const held = worst.get(key);
    if (held === undefined || level > held.level) {
      worst.set(key, {
        effectId: event.effectId,
        position: event.position,
        distance,
        level,
      });
    }
  }
  return [...worst.values()].sort((a, b) => b.level - a.level);
}

/**
 * The loudest single instant, counting everything that reports together.
 *
 * Reports inside about an eighth of a second are heard as one, so they add on
 * an energy basis rather than being read separately. That is why a barrage of
 * eight small shells can be louder at the boundary than one large one.
 */
const TOGETHER_MS = 120;

function distanceFrom(
  position: string,
  context: NoiseContext,
): Metres | undefined {
  const spot = context.rig.position(position);
  return spot === undefined
    ? undefined
    : distanceToBoundary(positionPoint(spot), context.sensitive);
}

export function peakLevel(
  schedule: Schedule | QuantisedSchedule,
  context: NoiseContext,
): number {
  let peak = 0;
  for (const event of schedule.events) {
    const levels: number[] = [];
    for (const other of schedule.events) {
      if (Math.abs(raw(other.visibleAt) - raw(event.visibleAt)) > TOGETHER_MS) {
        continue;
      }
      const distance = distanceFrom(other.position, context);
      if (distance === undefined) {
        continue;
      }
      levels.push(levelAt(levelAtTenFor(other.effect), distance));
    }
    peak = Math.max(peak, combineLevels(levels));
  }
  return peak;
}

export function checkNoise(
  schedule: Schedule | QuantisedSchedule,
  context: NoiseContext,
): DiagnosticBag {
  const diagnostics = new DiagnosticBag();
  const limit = context.limit;
  if (limit === undefined) {
    return diagnostics;
  }
  const peak = peakLevel(schedule, context);
  if (peak > limit) {
    diagnostics.error({
      code: "PF4200",
      message: `the show peaks at ${peak.toFixed(0)}dB against a ${limit}dB limit`,
      help: "drop the salutes, move the rack back, or ask for a higher limit",
    });
  } else if (peak > limit - 3) {
    diagnostics.warning({
      code: "PF4201",
      message: `the show peaks at ${peak.toFixed(0)}dB, within 3dB of the limit`,
    });
  }
  for (const finding of noiseFindings(schedule, context)) {
    if (finding.level > limit) {
      diagnostics.warning({
        code: "PF4202",
        message: `${finding.effectId} alone reads ${finding.level.toFixed(0)}dB from ${finding.position}`,
      });
    }
  }
  return diagnostics;
}

/** The largest bore that stays inside a limit at a distance. */
export function largestQuietCalibre(
  limit: number,
  distance: Metres,
  candidates: readonly Calibre[],
): Calibre | undefined {
  let best: Calibre | undefined;
  for (const size of candidates) {
    const level = levelAt(110 + (raw(size.size) - 50) * 0.09, distance);
    if (level <= limit) {
      best = size;
    }
  }
  return best;
}

/** A curfew is a wall clock time, so this only checks the show fits inside. */
export function fitsBeforeCurfew(
  schedule: Schedule | QuantisedSchedule,
  startedAtMs: number,
  curfewMs: number,
): boolean {
  const last = schedule.events.reduce(
    (latest, event) => Math.max(latest, raw(event.occupancy.end)),
    0,
  );
  return startedAtMs + last <= curfewMs;
}

export function describeNoise(
  schedule: Schedule | QuantisedSchedule,
  context: NoiseContext,
): string {
  const peak = peakLevel(schedule, context);
  const worst = noiseFindings(schedule, context)[0];
  const detail =
    worst === undefined
      ? "nothing to measure"
      : `loudest single effect ${worst.effectId} at ${worst.level.toFixed(0)}dB from ${raw(worst.distance).toFixed(0)}m`;
  return `peak ${peak.toFixed(0)}dB, ${detail}`;
}

/** Clamp a licence figure into a range a meter could actually read. */
export function usableLimit(value: number): number {
  return clamp(value, 60, 140);
}

/** The show clock moment of the loudest instant, for a report. */
export function loudestMoment(
  schedule: Schedule | QuantisedSchedule,
  context: NoiseContext,
): string {
  let peak = -1;
  let at = ms(0);
  for (const event of schedule.events) {
    const distance = distanceFrom(event.position, context);
    if (distance === undefined) {
      continue;
    }
    const level = levelAt(levelAtTenFor(event.effect), distance);
    if (level > peak) {
      peak = level;
      at = event.visibleAt;
    }
  }
  return peak < 0 ? "nothing" : formatShowTime(at);
}
