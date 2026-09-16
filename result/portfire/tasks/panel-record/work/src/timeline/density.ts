import type { FiringEvent, Schedule } from "./schedule.js";
import type { QuantisedSchedule } from "./quantise.js";
import { visibleWindowOf } from "../catalog/timing.js";
import { DiagnosticBag } from "../core/diagnostic.js";
import type { Interval } from "../core/interval.js";
import { coverage, gaps, merge, peakOverlap } from "../core/interval.js";
import { bucketBy, mean } from "../core/numeric.js";
import { formatShowTime } from "../core/timecode.js";
import type { Milliseconds } from "../core/units.js";
import { ms, raw } from "../core/units.js";

/**
 * How busy the sky is, and when it is empty.
 *
 * A display fails in two ways that have nothing to do with safety. It can be
 * so dense that nothing reads, because forty shells breaking together is one
 * white flash rather than forty effects. And it can have holes in it, because
 * a nine second gap in the middle of a piece of music reads as a misfire to
 * everyone watching whether anything went wrong or not.
 *
 * Both are measured on the visible window rather than the ignition, since the
 * audience does not care when the circuit closed.
 */

/** A gap longer than this reads as something having gone wrong. */
export const LULL_THRESHOLD: Milliseconds = ms(4000);

export interface DensitySample {
  readonly at: Milliseconds;
  readonly live: number;
}

export function visibleWindows(
  schedule: Schedule | QuantisedSchedule,
): Interval[] {
  return schedule.events.map((event) =>
    visibleWindowOf(event.effect, event.ignitionAt),
  );
}

export interface DensityReport {
  /** Most effects visible at any one instant. */
  readonly peak: number;
  readonly peakAt: Milliseconds;
  /** Total time with something in the air, counting overlaps once. */
  readonly litTime: Milliseconds;
  /** Show span from first light to last. */
  readonly span: Milliseconds;
  /** Fraction of the span with something visible. */
  readonly coverageFraction: number;
  readonly lulls: readonly Interval[];
  readonly longestLull: Milliseconds;
}

export function densityReport(
  schedule: Schedule | QuantisedSchedule,
  lullThreshold: Milliseconds = LULL_THRESHOLD,
): DensityReport {
  const windows = visibleWindows(schedule);
  if (windows.length === 0) {
    return {
      peak: 0,
      peakAt: ms(0),
      litTime: ms(0),
      span: ms(0),
      coverageFraction: 0,
      lulls: [],
      longestLull: ms(0),
    };
  }
  const merged = merge(windows);
  const first = merged[0];
  const last = merged[merged.length - 1];
  const span =
    first === undefined || last === undefined
      ? 0
      : raw(last.end) - raw(first.start);
  const peak = peakOverlap(windows);
  const lit = raw(coverage(windows));
  const quiet = gaps(windows).filter(
    (gap) => raw(gap.end) - raw(gap.start) >= raw(lullThreshold),
  );
  let longest = 0;
  for (const gap of quiet) {
    longest = Math.max(longest, raw(gap.end) - raw(gap.start));
  }
  return {
    peak: peak.count,
    peakAt: peak.at,
    litTime: ms(lit),
    span: ms(span),
    coverageFraction: span === 0 ? 0 : lit / span,
    lulls: quiet,
    longestLull: ms(longest),
  };
}

/**
 * Effects visible in each slice of the show, which is what a density plot
 * draws. The slice width is the caller's, because a two minute pyromusical
 * wants one second slices and a twenty minute municipal show wants ten.
 */
export function densityCurve(
  schedule: Schedule | QuantisedSchedule,
  sliceMs: number,
): DensitySample[] {
  const starts = schedule.events.map((event) =>
    raw(visibleWindowOf(event.effect, event.ignitionAt).start),
  );
  const buckets = bucketBy(starts, sliceMs);
  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([at, live]) => ({ at: ms(at), live }));
}

/** The busiest slice, which is where a show is most likely to wash out. */
export function busiestSlice(
  schedule: Schedule | QuantisedSchedule,
  sliceMs: number,
): DensitySample | undefined {
  let best: DensitySample | undefined;
  for (const sample of densityCurve(schedule, sliceMs)) {
    if (best === undefined || sample.live > best.live) {
      best = sample;
    }
  }
  return best;
}

export interface DensityLimits {
  /** Most effects that may be visible at once before it reads as a wash. */
  readonly maxSimultaneous?: number;
  readonly lullThreshold?: Milliseconds;
}

export function checkDensity(
  schedule: Schedule | QuantisedSchedule,
  limits: DensityLimits = {},
): DiagnosticBag {
  const diagnostics = new DiagnosticBag();
  const report = densityReport(
    schedule,
    limits.lullThreshold ?? LULL_THRESHOLD,
  );
  const cap = limits.maxSimultaneous;
  if (cap !== undefined && report.peak > cap) {
    diagnostics.warning({
      code: "PF3200",
      message: `${report.peak} effects are lit at ${formatShowTime(report.peakAt)}, over the ${cap} you asked for`,
      help: "past this it reads as one flash rather than several effects",
    });
  }
  for (const lull of report.lulls) {
    const length = raw(lull.end) - raw(lull.start);
    diagnostics.warning({
      code: "PF3201",
      message: `nothing is lit for ${(length / 1000).toFixed(1)}s from ${formatShowTime(lull.start)}`,
      help: "an audience reads a gap this long as a misfire",
    });
  }
  return diagnostics;
}

/** Average effects lit per second over the show, for a one line summary. */
export function averageDensity(schedule: Schedule | QuantisedSchedule): number {
  const curve = densityCurve(schedule, 1000);
  return curve.length === 0 ? 0 : mean(curve.map((sample) => sample.live));
}

export function describeDensity(report: DensityReport): string {
  const lit = (raw(report.litTime) / 1000).toFixed(1);
  const span = (raw(report.span) / 1000).toFixed(1);
  const percent = (report.coverageFraction * 100).toFixed(0);
  return `peak ${report.peak} at ${formatShowTime(report.peakAt)}, lit ${lit}s of ${span}s (${percent}%), ${report.lulls.length} lulls`;
}

/** Events that overlap the busiest instant, so a report can name them. */
export function eventsAtPeak(
  schedule: Schedule | QuantisedSchedule,
): FiringEvent[] {
  const report = densityReport(schedule);
  return schedule.events.filter((event) => {
    const window = visibleWindowOf(event.effect, event.ignitionAt);
    return (
      raw(window.start) <= raw(report.peakAt) &&
      raw(report.peakAt) < raw(window.end)
    );
  });
}
