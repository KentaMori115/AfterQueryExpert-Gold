import { describeEffect } from "../catalog/effect.js";
import { visibleWindowOf } from "../catalog/timing.js";
import { countBy, distinct, rankedEntries } from "../core/collect.js";
import { clamp } from "../core/numeric.js";
import { renderTable } from "../core/text.js";
import { formatShowTime } from "../core/timecode.js";
import { ms, raw } from "../core/units.js";
import type { Milliseconds } from "../core/units.js";
import type { QuantisedSchedule } from "../timeline/quantise.js";
import type { FiringEvent, Schedule } from "../timeline/schedule.js";

/**
 * Seeing the show without firing it.
 *
 * A designer works from a script and cannot picture what it looks like. A
 * preview will not replace standing in a field, but it answers the two
 * questions the script cannot: is the shape of the show right, and is anything
 * happening at the moment I think it is.
 *
 * It is text rather than a picture because it goes in a terminal, a diff and
 * an email, and because a bar chart made of characters can be read on a phone
 * in a van without anything being installed.
 */

const BLOCKS = [" ", ".", ":", "|", "#"];

export interface PreviewOptions {
  /** How much show time one column stands for. */
  readonly sliceMs?: number;
  /** How many columns to print before wrapping. */
  readonly width?: number;
}

/** How many effects are lit during each slice of the show. */
export function litPerSlice(
  schedule: Schedule | QuantisedSchedule,
  sliceMs: number,
): number[] {
  if (schedule.events.length === 0) {
    return [];
  }
  let first = Number.POSITIVE_INFINITY;
  let last = Number.NEGATIVE_INFINITY;
  const windows = schedule.events.map((event) => {
    const window = visibleWindowOf(event.effect, event.ignitionAt);
    first = Math.min(first, raw(window.start));
    last = Math.max(last, raw(window.end));
    return window;
  });
  const slices = Math.max(1, Math.ceil((last - first) / sliceMs));
  const counts = new Array<number>(slices).fill(0);
  for (const window of windows) {
    const from = Math.floor((raw(window.start) - first) / sliceMs);
    const to = Math.ceil((raw(window.end) - first) / sliceMs);
    for (let i = Math.max(0, from); i < Math.min(slices, to); i += 1) {
      counts[i] = (counts[i] ?? 0) + 1;
    }
  }
  return counts;
}

/** The moment the first thing is visible, which is where a preview starts. */
export function previewStart(
  schedule: Schedule | QuantisedSchedule,
): Milliseconds {
  let first = Number.POSITIVE_INFINITY;
  for (const event of schedule.events) {
    first = Math.min(
      first,
      raw(visibleWindowOf(event.effect, event.ignitionAt).start),
    );
  }
  return ms(Number.isFinite(first) ? first : 0);
}

function blockFor(count: number, peak: number): string {
  if (count === 0) {
    return BLOCKS[0] ?? " ";
  }
  const step = Math.ceil((count / Math.max(1, peak)) * (BLOCKS.length - 1));
  return BLOCKS[clamp(step, 1, BLOCKS.length - 1)] ?? "#";
}

/**
 * A bar chart of the whole show, wrapped into rows with a time label on each.
 * The label is the show clock at the start of the row, so a designer can point
 * at a column and say which bar of the music it is.
 */
export function previewChart(
  schedule: Schedule | QuantisedSchedule,
  options: PreviewOptions = {},
): string {
  const sliceMs = options.sliceMs ?? 1000;
  const width = options.width ?? 60;
  const counts = litPerSlice(schedule, sliceMs);
  if (counts.length === 0) {
    return "nothing to preview";
  }
  const peak = Math.max(...counts);
  const start = raw(previewStart(schedule));
  const rows: string[] = [];
  for (let i = 0; i < counts.length; i += width) {
    const slice = counts.slice(i, i + width);
    const label = formatShowTime(ms(start + i * sliceMs));
    rows.push(
      `${label.padStart(9)} ${slice.map((count) => blockFor(count, peak)).join("")}`,
    );
  }
  rows.push(`peak ${peak} lit, one column is ${(sliceMs / 1000).toFixed(1)}s`);
  return rows.join("\n");
}

export interface Beat {
  readonly at: Milliseconds;
  readonly events: readonly FiringEvent[];
}

/**
 * Group the show into moments where something happens together. A gap wider
 * than the window starts a new moment, which is roughly how an audience reads
 * a show.
 */
export function beatsOf(
  schedule: Schedule | QuantisedSchedule,
  windowMs = 400,
): Beat[] {
  const sorted = [...schedule.events].sort(
    (a, b) => raw(a.visibleAt) - raw(b.visibleAt),
  );
  const beats: Beat[] = [];
  let current: FiringEvent[] = [];
  let anchor = 0;
  for (const event of sorted) {
    const at = raw(event.visibleAt);
    if (current.length === 0 || at - anchor <= windowMs) {
      if (current.length === 0) {
        anchor = at;
      }
      current.push(event);
      continue;
    }
    beats.push({ at: ms(anchor), events: current });
    current = [event];
    anchor = at;
  }
  if (current.length > 0) {
    beats.push({ at: ms(anchor), events: current });
  }
  return beats;
}

/** A storyboard, one row per moment, for reading the shape of a show. */
export function storyboard(
  schedule: Schedule | QuantisedSchedule,
  windowMs = 400,
): string {
  const beats = beatsOf(schedule, windowMs);
  if (beats.length === 0) {
    return "nothing to preview";
  }
  const rows = beats.map((beat) => {
    const kinds = countBy(beat.events, (event) => describeEffect(event.effect));
    const description = rankedEntries(kinds)
      .map(([what, count]) => (count === 1 ? what : `${count} x ${what}`))
      .join(", ");
    const positions = distinct(beat.events, (event) => event.position);
    return [
      formatShowTime(beat.at),
      String(beat.events.length),
      positions.join(" "),
      description,
    ];
  });
  return renderTable(
    [
      { header: "at", align: "right" },
      { header: "shots", align: "right" },
      { header: "from" },
      { header: "what", maxWidth: 48 },
    ],
    rows,
  );
}
