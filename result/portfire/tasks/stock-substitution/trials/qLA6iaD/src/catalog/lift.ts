import type { Calibre } from "./calibre.js";
import type { Metres, Milliseconds } from "../core/units.js";
import { metres, ms, raw } from "../core/units.js";
import { clamp, lerp } from "../core/numeric.js";

/**
 * How long a shell takes to get to its break, and how high that is.
 *
 * This is the number the whole compiler exists to apply. A six inch shell
 * spends about four seconds climbing. Write the cue at the downbeat and the
 * break lands four seconds late, which on a two minute pyromusical is the
 * difference between a show and an accident with a soundtrack.
 *
 * The figures are an interpolation table rather than a closed form. Lift is
 * dominated by drag on a bluff body with a changing mass, and every attempt to
 * write it as physics ends up fitted to the same measurements anyway. The
 * table is the industry rule of thumb, roughly a hundred feet of altitude per
 * inch of calibre, with the flight times crews actually measure.
 */

interface LiftPoint {
  readonly sizeMm: number;
  readonly apogeeM: number;
  readonly riseMs: number;
}

const TABLE: readonly LiftPoint[] = [
  { sizeMm: 50, apogeeM: 60, riseMs: 1900 },
  { sizeMm: 63, apogeeM: 75, riseMs: 2150 },
  { sizeMm: 75, apogeeM: 90, riseMs: 2400 },
  { sizeMm: 100, apogeeM: 120, riseMs: 3000 },
  { sizeMm: 125, apogeeM: 150, riseMs: 3500 },
  { sizeMm: 150, apogeeM: 180, riseMs: 4000 },
  { sizeMm: 200, apogeeM: 240, riseMs: 4800 },
  { sizeMm: 250, apogeeM: 300, riseMs: 5500 },
  { sizeMm: 300, apogeeM: 360, riseMs: 6200 },
  { sizeMm: 350, apogeeM: 410, riseMs: 6800 },
  { sizeMm: 400, apogeeM: 460, riseMs: 7300 },
];

/**
 * The delay between the panel closing the circuit and the lift charge going.
 * An electric match takes a few milliseconds to bridge and the quickmatch
 * leader adds a little more. It is small next to the rise time but it is not
 * zero, and it is the same for every cue, so leaving it out shifts the whole
 * show rather than one shell.
 */
export const IGNITION_DELAY: Milliseconds = ms(30);

function interpolate(
  sizeMm: number,
  read: (point: LiftPoint) => number,
): number {
  const first = TABLE[0];
  const last = TABLE[TABLE.length - 1];
  if (first === undefined || last === undefined) {
    throw new Error("the lift table is empty");
  }
  if (sizeMm <= first.sizeMm) {
    return read(first) * (sizeMm / first.sizeMm);
  }
  if (sizeMm >= last.sizeMm) {
    return read(last);
  }
  for (let i = 1; i < TABLE.length; i += 1) {
    const low = TABLE[i - 1];
    const high = TABLE[i];
    if (low === undefined || high === undefined) {
      continue;
    }
    if (sizeMm <= high.sizeMm) {
      const t = (sizeMm - low.sizeMm) / (high.sizeMm - low.sizeMm);
      return lerp(read(low), read(high), t);
    }
  }
  return read(last);
}

/** Where a shell of this calibre breaks when lifted on a full charge. */
export function apogeeFor(value: Calibre): Metres {
  return metres(Math.round(interpolate(raw(value.size), (p) => p.apogeeM)));
}

/** How long it takes to get there, from lift to break. */
export function riseTimeFor(value: Calibre): Milliseconds {
  return ms(Math.round(interpolate(raw(value.size), (p) => p.riseMs)));
}

/**
 * Rise time to a break lower than the shell's own apogee, which is what a
 * reduced lift charge buys on a tight site. Flight is close enough to
 * ballistic near the top that time scales with the square root of height, and
 * fitting anything more elaborate to a charge nobody measured is false
 * precision.
 */
export function riseTimeToHeight(value: Calibre, height: Metres): Milliseconds {
  const full = raw(apogeeFor(value));
  const wanted = clamp(raw(height), 0, full);
  const scale = Math.sqrt(wanted / full);
  return ms(Math.round(raw(riseTimeFor(value)) * scale));
}

/**
 * How long before the wanted break the panel has to fire. This is rise time
 * plus the ignition delay, and it is the number that goes into the firing
 * table.
 */
export function leadTimeFor(value: Calibre): Milliseconds {
  return ms(raw(riseTimeFor(value)) + raw(IGNITION_DELAY));
}

/** Vertical speed as the shell leaves the mortar, for the trajectory model. */
export function muzzleVelocityFor(value: Calibre): number {
  const height = raw(apogeeFor(value));
  const rise = raw(riseTimeFor(value)) / 1000;
  // Average speed over the climb, doubled, is the launch speed under constant
  // deceleration. Drag makes the real figure a little higher, and the model
  // that uses this compensates for that separately.
  return (2 * height) / rise;
}

export interface LiftProfile {
  readonly apogee: Metres;
  readonly rise: Milliseconds;
  readonly lead: Milliseconds;
  readonly muzzleVelocity: number;
}

export function liftProfile(value: Calibre): LiftProfile {
  return {
    apogee: apogeeFor(value),
    rise: riseTimeFor(value),
    lead: leadTimeFor(value),
    muzzleVelocity: muzzleVelocityFor(value),
  };
}

/** The calibres the table was measured at, for a reference listing. */
export function tabulatedSizes(): number[] {
  return TABLE.map((point) => point.sizeMm);
}
