import type { QuantisedSchedule } from "./quantise.js";
import type { Schedule } from "./schedule.js";
import { countBy, sortedEntries } from "../core/collect.js";
import { DiagnosticBag } from "../core/diagnostic.js";
import { mean, stdDev } from "../core/numeric.js";
import { renderTable } from "../core/text.js";
import { formatShowTime } from "../core/timecode.js";
import { ms, raw } from "../core/units.js";
import type { Milliseconds } from "../core/units.js";
import type { Rig } from "../rig/rig.js";

/**
 * Whether the show is even.
 *
 * Two kinds of lopsidedness spoil a display and neither shows up in any of the
 * other checks. A show that puts three quarters of its work on one bank reads
 * as a rehearsal for a show on the other bank. And a show that front loads
 * everything leaves an audience standing in a field for the last minute
 * wondering whether that was it.
 *
 * Both are matters of judgement, so everything here is a note or a warning
 * with a number attached, never an error. The designer decides.
 */

export interface PositionShare {
  readonly position: string;
  readonly shots: number;
  readonly share: number;
  /** East coordinate, so a report can order the positions across the field. */
  readonly east: number;
}

export function positionShares(
  schedule: Schedule | QuantisedSchedule,
  rig: Rig,
): PositionShare[] {
  const counts = countBy(schedule.events, (event) => event.position);
  const total = schedule.events.length;
  return sortedEntries(counts)
    .map(([position, shots]) => ({
      position,
      shots,
      share: total === 0 ? 0 : shots / total,
      east: rig.position(position)?.east ?? 0,
    }))
    .sort((a, b) => a.east - b.east || a.position.localeCompare(b.position));
}

/**
 * How far the show leans, from minus one for everything on the far left to
 * plus one for everything on the far right. Zero is balanced, and anything
 * past about a third of the way is visible from the audience line.
 */
export function lateralLean(
  schedule: Schedule | QuantisedSchedule,
  rig: Rig,
): number {
  const shares = positionShares(schedule, rig);
  if (shares.length === 0) {
    return 0;
  }
  const easts = shares.map((share) => share.east);
  const left = Math.min(...easts);
  const right = Math.max(...easts);
  if (right === left) {
    return 0;
  }
  let weighted = 0;
  for (const share of shares) {
    const place = ((share.east - left) / (right - left)) * 2 - 1;
    weighted += place * share.share;
  }
  return Number(weighted.toFixed(4));
}

export interface TimeBalance {
  /** Shots in each quarter of the show, first to last. */
  readonly quarters: readonly number[];
  /** Fraction of shots in the last quarter, which is where a finale sits. */
  readonly finaleShare: number;
  readonly start: Milliseconds;
  readonly end: Milliseconds;
}

export function timeBalance(
  schedule: Schedule | QuantisedSchedule,
): TimeBalance {
  const events = schedule.events;
  if (events.length === 0) {
    return {
      quarters: [0, 0, 0, 0],
      finaleShare: 0,
      start: ms(0),
      end: ms(0),
    };
  }
  let first = Number.POSITIVE_INFINITY;
  let last = Number.NEGATIVE_INFINITY;
  for (const event of events) {
    first = Math.min(first, raw(event.visibleAt));
    last = Math.max(last, raw(event.visibleAt));
  }
  const span = Math.max(1, last - first);
  const quarters = [0, 0, 0, 0];
  for (const event of events) {
    const place = Math.min(
      3,
      Math.floor(((raw(event.visibleAt) - first) / span) * 4),
    );
    quarters[place] = (quarters[place] ?? 0) + 1;
  }
  return {
    quarters,
    finaleShare: (quarters[3] ?? 0) / events.length,
    start: ms(first),
    end: ms(last),
  };
}

export interface BalanceLimits {
  /** Lean past this is worth mentioning. */
  readonly maxLean?: number;
  /** A finale holding less than this share is worth mentioning. */
  readonly minFinaleShare?: number;
}

export function checkBalance(
  schedule: Schedule | QuantisedSchedule,
  rig: Rig,
  limits: BalanceLimits = {},
): DiagnosticBag {
  const diagnostics = new DiagnosticBag();
  if (schedule.events.length === 0) {
    return diagnostics;
  }
  const maxLean = limits.maxLean ?? 0.35;
  const lean = lateralLean(schedule, rig);
  if (Math.abs(lean) > maxLean) {
    diagnostics.warning({
      code: "PF3600",
      message: `the show leans ${Math.abs(lean * 100).toFixed(0)}% to the ${lean > 0 ? "right" : "left"}`,
      help: "an audience reads this as one bank being the show and the other a rehearsal",
    });
  }

  const balance = timeBalance(schedule);
  const minFinale = limits.minFinaleShare ?? 0.2;
  if (balance.finaleShare < minFinale) {
    diagnostics.note({
      code: "PF3601",
      message: `the last quarter holds ${(balance.finaleShare * 100).toFixed(0)}% of the shots`,
      help: "a show that front loads leaves the audience wondering whether that was it",
    });
  }

  const shares = positionShares(schedule, rig);
  const spread = stdDev(shares.map((share) => share.shots));
  const average = mean(shares.map((share) => share.shots));
  if (shares.length > 2 && average > 0 && spread / average > 0.75) {
    diagnostics.note({
      code: "PF3602",
      message: "the positions carry very different amounts of work",
      help: shares
        .map((share) => `${share.position} ${share.shots}`)
        .join(", "),
    });
  }
  return diagnostics;
}

export function describeBalance(
  schedule: Schedule | QuantisedSchedule,
  rig: Rig,
): string {
  const shares = positionShares(schedule, rig);
  const balance = timeBalance(schedule);
  const table = renderTable(
    [
      { header: "position" },
      { header: "east", align: "right" },
      { header: "shots", align: "right" },
      { header: "share", align: "right" },
    ],
    shares.map((share) => [
      share.position,
      share.east.toFixed(0),
      String(share.shots),
      `${(share.share * 100).toFixed(0)}%`,
    ]),
  );
  const lean = lateralLean(schedule, rig);
  return [
    table,
    "",
    `lean ${lean >= 0 ? "+" : ""}${lean.toFixed(2)}, quarters ${balance.quarters.join(" ")}`,
    `runs ${formatShowTime(balance.start)} to ${formatShowTime(balance.end)}`,
  ].join("\n");
}
