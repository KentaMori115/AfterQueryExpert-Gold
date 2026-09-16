import type { FiringEvent, Schedule } from "./schedule.js";
import { compareEvents } from "./schedule.js";
import { DiagnosticBag } from "../core/diagnostic.js";
import { frameDuration, quantiseToFrame } from "../core/timecode.js";
import type { TimecodeFormat } from "../core/timecode.js";
import type { Milliseconds } from "../core/units.js";
import { ms, raw } from "../core/units.js";
import { formatPin } from "../rig/pin.js";
import { mean, percentile } from "../core/numeric.js";

/**
 * Snapping the table onto the panel's own clock.
 *
 * A panel does not fire on arbitrary milliseconds. It runs a tick, typically
 * one video frame, and every event lands on a tick whether the table asked for
 * it or not. Doing that rounding here rather than leaving it to the panel
 * means the table a shooter checks is the table that runs, and it means the
 * compiler can say how far each cue moved.
 *
 * The drift that matters is not the average. It is the worst case on the
 * tightest ripple, because a forty millisecond ripple on a twenty five frame
 * clock has a whole frame of slack per shot and can visibly stutter.
 */

export interface QuantisedEvent extends FiringEvent {
  /** How far the ignition moved to reach a frame boundary. */
  readonly drift: Milliseconds;
}

export interface QuantisedSchedule {
  readonly events: readonly QuantisedEvent[];
  readonly format: TimecodeFormat;
  readonly preRoll: Milliseconds;
  readonly duration: Milliseconds;
}

export function quantiseSchedule(
  schedule: Schedule,
  format: TimecodeFormat,
): QuantisedSchedule {
  const events: QuantisedEvent[] = schedule.events.map((event) => {
    const snapped = quantiseToFrame(event.ignitionAt, format);
    const drift = ms(raw(snapped) - raw(event.ignitionAt));
    const shift = raw(drift);
    return {
      ...event,
      ignitionAt: snapped,
      visibleAt: ms(raw(event.visibleAt) + shift),
      drift,
      occupancy: {
        start: ms(raw(event.occupancy.start) + shift),
        end: ms(raw(event.occupancy.end) + shift),
      },
    };
  });
  events.sort(compareEvents);
  return {
    events,
    format,
    preRoll: schedule.preRoll,
    duration: schedule.duration,
  };
}

export interface DriftReport {
  readonly worst: number;
  readonly worstEvent?: QuantisedEvent;
  readonly average: number;
  readonly ninetyFifth: number;
  /** Frame length, so a caller can say what fraction of a frame the drift is. */
  readonly frame: Milliseconds;
}

export function driftReport(schedule: QuantisedSchedule): DriftReport {
  const drifts = schedule.events.map((event) => Math.abs(raw(event.drift)));
  let worst = 0;
  let worstEvent: QuantisedEvent | undefined;
  for (const event of schedule.events) {
    const value = Math.abs(raw(event.drift));
    if (value > worst) {
      worst = value;
      worstEvent = event;
    }
  }
  return {
    worst,
    ...(worstEvent === undefined ? {} : { worstEvent }),
    average: mean(drifts),
    ninetyFifth: percentile(drifts, 0.95),
    frame: frameDuration(schedule.format),
  };
}

/**
 * Two events that wanted different times and got the same one. On a ripple
 * this is the difference between a run and a single louder report, so it is
 * worth a warning even though nothing is technically wrong.
 */
export function collapsedPairs(
  schedule: QuantisedSchedule,
): [QuantisedEvent, QuantisedEvent][] {
  const pairs: [QuantisedEvent, QuantisedEvent][] = [];
  for (let i = 1; i < schedule.events.length; i += 1) {
    const previous = schedule.events[i - 1];
    const current = schedule.events[i];
    if (previous === undefined || current === undefined) {
      continue;
    }
    if (
      raw(previous.ignitionAt) === raw(current.ignitionAt) &&
      raw(previous.drift) !== raw(current.drift)
    ) {
      pairs.push([previous, current]);
    }
  }
  return pairs;
}

export function checkQuantisation(schedule: QuantisedSchedule): DiagnosticBag {
  const diagnostics = new DiagnosticBag();
  const report = driftReport(schedule);
  const frame = raw(report.frame);

  if (report.worst > frame / 2 + 0.001) {
    diagnostics.warning({
      code: "PF3000",
      message: `an event moved ${report.worst.toFixed(1)}ms, over half a frame`,
    });
  }
  const collapsed = collapsedPairs(schedule);
  if (collapsed.length > 0) {
    const first = collapsed[0];
    diagnostics.warning({
      code: "PF3001",
      message: `${collapsed.length} pairs of cues land on the same frame`,
      ...(first === undefined
        ? {}
        : {
            help: `the first is ${formatPin(first[0].address)} and ${formatPin(first[1].address)}, so that run will read as one report`,
          }),
    });
  }
  return diagnostics;
}

/**
 * The tightest gap between consecutive ignitions, which says whether the frame
 * rate is fine enough for the show that was written.
 */
export function tightestGap(schedule: QuantisedSchedule): Milliseconds {
  let tightest = Number.POSITIVE_INFINITY;
  for (let i = 1; i < schedule.events.length; i += 1) {
    const previous = schedule.events[i - 1];
    const current = schedule.events[i];
    if (previous === undefined || current === undefined) {
      continue;
    }
    const gap = raw(current.ignitionAt) - raw(previous.ignitionAt);
    if (gap > 0 && gap < tightest) {
      tightest = gap;
    }
  }
  return ms(Number.isFinite(tightest) ? tightest : 0);
}

/** Whether the format can hold the show without collapsing any run. */
export function frameRateSuits(schedule: QuantisedSchedule): boolean {
  return collapsedPairs(schedule).length === 0;
}
