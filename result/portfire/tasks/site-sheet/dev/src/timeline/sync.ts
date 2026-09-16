import type { QuantisedSchedule } from "./quantise.js";
import type { FiringEvent, Schedule } from "./schedule.js";
import { DiagnosticBag } from "../core/diagnostic.js";
import { mean, percentile } from "../core/numeric.js";
import { formatShowTime } from "../core/timecode.js";
import type { Milliseconds } from "../core/units.js";
import { ms, raw } from "../core/units.js";

/**
 * Putting the show on the music.
 *
 * A pyromusical is judged on whether the breaks land on the beat, and the ear
 * is far better at this than people expect. Twenty milliseconds early reads as
 * tight, eighty milliseconds late reads as sloppy, and the difference between
 * those two is two frames.
 *
 * The grid here is a tempo map rather than a single tempo, because real music
 * changes tempo and a show cut against one constant bpm drifts a bar out by
 * the end of a four minute track.
 */

export interface TempoSection {
  /** Where this tempo starts on the show clock. */
  readonly from: Milliseconds;
  readonly bpm: number;
  /** Beats in a bar, for reporting a position as bar and beat. */
  readonly beatsPerBar: number;
}

export interface BeatGrid {
  readonly sections: readonly TempoSection[];
}

export function beatGrid(sections: readonly TempoSection[]): BeatGrid {
  if (sections.length === 0) {
    throw new RangeError("a beat grid needs at least one tempo section");
  }
  for (const section of sections) {
    if (section.bpm <= 0 || !Number.isFinite(section.bpm)) {
      throw new RangeError(`a tempo of ${section.bpm} bpm makes no sense`);
    }
    if (!Number.isInteger(section.beatsPerBar) || section.beatsPerBar < 1) {
      throw new RangeError("beats per bar has to be a whole number above zero");
    }
  }
  const sorted = [...sections].sort((a, b) => raw(a.from) - raw(b.from));
  return { sections: sorted };
}

/** One tempo throughout, which is what a click track gives you. */
export function steadyGrid(bpm: number, beatsPerBar = 4): BeatGrid {
  return beatGrid([{ from: ms(0), bpm, beatsPerBar }]);
}

function sectionAt(grid: BeatGrid, at: Milliseconds): TempoSection {
  let chosen = grid.sections[0];
  for (const section of grid.sections) {
    if (raw(section.from) <= raw(at)) {
      chosen = section;
    }
  }
  if (chosen === undefined) {
    throw new Error("a beat grid lost its first section");
  }
  return chosen;
}

export function beatLength(grid: BeatGrid, at: Milliseconds): Milliseconds {
  return ms(60000 / sectionAt(grid, at).bpm);
}

/** The beat boundaries either side of a moment. */
export function nearestBeat(grid: BeatGrid, at: Milliseconds): Milliseconds {
  const section = sectionAt(grid, at);
  const step = 60000 / section.bpm;
  const since = raw(at) - raw(section.from);
  const beats = Math.round(since / step);
  return ms(raw(section.from) + beats * step);
}

/** How far a moment sits from the nearest beat, signed, late is positive. */
export function offBeat(grid: BeatGrid, at: Milliseconds): Milliseconds {
  return ms(raw(at) - raw(nearestBeat(grid, at)));
}

export interface BarPosition {
  readonly bar: number;
  readonly beat: number;
}

/** Bar and beat, both counting from one, the way a musician says them. */
export function barPosition(grid: BeatGrid, at: Milliseconds): BarPosition {
  const section = sectionAt(grid, at);
  const step = 60000 / section.bpm;
  const since = Math.max(0, raw(at) - raw(section.from));
  const beats = Math.floor(since / step + 1e-6);
  return {
    bar: Math.floor(beats / section.beatsPerBar) + 1,
    beat: (beats % section.beatsPerBar) + 1,
  };
}

export interface SyncReport {
  /** Signed offsets of every break from its nearest beat. */
  readonly offsets: readonly number[];
  readonly worst: number;
  readonly worstEvent?: FiringEvent;
  readonly average: number;
  readonly ninetyFifth: number;
  /** Breaks within a tight window of a beat, as a fraction of all of them. */
  readonly onBeatFraction: number;
}

/** Inside this a break reads as on the beat. Two frames at twenty five. */
export const TIGHT_MS = 80;

export function syncReport(
  schedule: Schedule | QuantisedSchedule,
  grid: BeatGrid,
  tightMs: number = TIGHT_MS,
): SyncReport {
  const offsets: number[] = [];
  let worst = 0;
  let worstEvent: FiringEvent | undefined;
  let onBeat = 0;
  for (const event of schedule.events) {
    const offset = raw(offBeat(grid, event.visibleAt));
    offsets.push(offset);
    if (Math.abs(offset) <= tightMs) {
      onBeat += 1;
    }
    if (Math.abs(offset) > Math.abs(worst)) {
      worst = offset;
      worstEvent = event;
    }
  }
  return {
    offsets,
    worst,
    ...(worstEvent === undefined ? {} : { worstEvent }),
    average: mean(offsets.map(Math.abs)),
    ninetyFifth: percentile(offsets.map(Math.abs), 0.95),
    onBeatFraction: offsets.length === 0 ? 1 : onBeat / offsets.length,
  };
}

export function checkSync(
  schedule: Schedule | QuantisedSchedule,
  grid: BeatGrid,
  tightMs: number = TIGHT_MS,
): DiagnosticBag {
  const diagnostics = new DiagnosticBag();
  const report = syncReport(schedule, grid, tightMs);
  if (report.worstEvent !== undefined && Math.abs(report.worst) > tightMs * 2) {
    const where = formatShowTime(report.worstEvent.visibleAt);
    diagnostics.warning({
      code: "PF3300",
      message: `${report.worstEvent.effectId} breaks ${Math.abs(report.worst).toFixed(0)}ms off the beat at ${where}`,
      help: report.worst > 0 ? "it reads late" : "it reads early",
    });
  }
  if (report.offsets.length > 0 && report.onBeatFraction < 0.5) {
    diagnostics.warning({
      code: "PF3301",
      message: `only ${(report.onBeatFraction * 100).toFixed(0)}% of breaks land on a beat`,
      help: "check the tempo map against the track before moving cues",
    });
  }
  return diagnostics;
}

/** Move a moment onto the nearest beat, for a cue being tightened by hand. */
export function snapToBeat(grid: BeatGrid, at: Milliseconds): Milliseconds {
  return nearestBeat(grid, at);
}

export function describeSync(report: SyncReport): string {
  const percent = (report.onBeatFraction * 100).toFixed(0);
  return `${percent}% on the beat, worst ${report.worst.toFixed(0)}ms, average ${report.average.toFixed(0)}ms`;
}
