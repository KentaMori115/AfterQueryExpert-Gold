import type { Effect } from "./effect.js";
import type { Magazine } from "./inventory.js";
import type { Catalog } from "./registry.js";
import type { Substitute, SubstituteOptions } from "./substitute.js";
import { substitutesFor } from "./substitute.js";
import { DiagnosticBag } from "../core/diagnostic.js";
import { compareIds } from "../core/ids.js";
import { plural } from "../core/text.js";
import { raw } from "../core/units.js";
import type { ResolvedShot } from "../script/resolve.js";

/**
 * Drawing the show out of the magazine.
 *
 * A show is designed against the house catalog and fired out of whatever the
 * magazine actually holds, and those two are never the same thing on the day.
 * Resolution says what the script means; this says what the crew will pick up.
 *
 * Two passes, and the order of them is the whole point. Every cue draws the
 * shell it was written for first, in firing order, so the shortfall lands on
 * the cues at the end of the show rather than on whichever cue happens to be
 * first in the file. Only when nobody is left waiting for their own shell does
 * the drawer go back and stand something else in for the cues that missed out.
 * Doing it in one pass would let cue three quietly take the last six inch palm
 * as a substitute while cue four, which was written for that palm, goes short.
 *
 * A shell lent to one cue is gone, so a single shortfall can be covered by
 * several different stand-ins, and a cue nothing covers keeps what was written
 * and stops the show from being ready.
 */

export interface DrawOptions {
  /**
   * Lot numbers set aside before the draw, which is what a recall or a damaged
   * case means. The book itself is never touched, so a pulled lot is simply
   * not there for this show.
   */
  readonly pull?: readonly string[];
  /** Passed to `substitutesFor`, for a caller that wants a tighter match. */
  readonly substitutes?: SubstituteOptions;
}

export interface StandIn {
  /** What is fired instead. */
  readonly effectId: string;
  readonly effect: Effect;
  /** Exact when the calibre matches, near when only the handling band does. */
  readonly quality: "exact" | "near";
  /** How many shots it covers. */
  readonly shots: number;
  /** The lots those shots come out of, in the order they were opened. */
  readonly lots: readonly string[];
}

export interface DrawLine {
  /** What the script asked for. */
  readonly effectId: string;
  /** How many shots asked for it. */
  readonly asked: number;
  /** How many of those drew the effect itself. */
  readonly drawn: number;
  /** The lots it was drawn from, in the order they were opened. */
  readonly lots: readonly string[];
  readonly standIns: readonly StandIn[];
  /** Shots nothing covered, which keep what was written. */
  readonly uncovered: number;
}

export interface Draw {
  /** The shots as they will be fired, with lots and stand-ins filled in. */
  readonly shots: readonly ResolvedShot[];
  /** One line per effect the script asked for, in name order. */
  readonly lines: readonly DrawLine[];
  readonly diagnostics: DiagnosticBag;
}

interface Held {
  readonly lotNumber: string;
  readonly received?: string;
  remaining: number;
}

/**
 * Which lot to open first. Oldest received wins, because stock that has sat
 * longest is the stock a crew wants gone, and an undated row goes last rather
 * than first: plenty of older rows have no date and treating a blank as the
 * beginning of time would empty exactly the lots nobody can trace.
 */
function compareHeld(a: Held, b: Held): number {
  if (a.received !== b.received) {
    if (a.received === undefined) {
      return 1;
    }
    if (b.received === undefined) {
      return -1;
    }
    return a.received < b.received ? -1 : 1;
  }
  return compareIds(a.lotNumber, b.lotNumber);
}

/**
 * A working copy of the stock. The magazine book is a legal record and a show
 * compile is a what if, so nothing here writes back to it.
 */
class WorkingStock {
  private readonly held = new Map<string, Held[]>();

  constructor(magazine: Magazine, pull: ReadonlySet<string>) {
    for (const line of magazine.stock()) {
      const lots = line.lots
        .filter((lot) => !pull.has(lot.lotNumber.trim().toLowerCase()))
        .map((lot) => ({
          lotNumber: lot.lotNumber,
          ...(lot.received === undefined ? {} : { received: lot.received }),
          remaining: lot.quantity,
        }))
        .sort(compareHeld);
      if (lots.length > 0) {
        this.held.set(line.effectId, lots);
      }
    }
  }

  /** Take one unit and say which lot it came from, or nothing when there is none. */
  draw(effectId: string): string | undefined {
    for (const lot of this.held.get(effectId) ?? []) {
      if (lot.remaining > 0) {
        lot.remaining -= 1;
        return lot.lotNumber;
      }
    }
    return undefined;
  }
}

interface Working {
  readonly effectId: string;
  asked: number;
  drawn: number;
  readonly lots: string[];
  readonly standIns: Map<string, { standIn: StandIn; lots: string[] }>;
  uncovered: number;
}

/** Lots are listed once each, in the order they were opened. */
function addLot(lots: string[], lot: string): string[] {
  if (!lots.includes(lot)) {
    lots.push(lot);
  }
  return lots;
}

function lineFor(lines: Map<string, Working>, effectId: string): Working {
  const existing = lines.get(effectId);
  if (existing !== undefined) {
    return existing;
  }
  const created: Working = {
    effectId,
    asked: 0,
    drawn: 0,
    lots: [],
    standIns: new Map(),
    uncovered: 0,
  };
  lines.set(effectId, created);
  return created;
}

/**
 * Firing order, which is visible time and then the order the shots were
 * written in. Two cues on the same beat is common, and the one written first
 * gets the shell, because that is the only tie break a shooter can predict.
 */
function firingOrder(
  shots: readonly ResolvedShot[],
): { shot: ResolvedShot; index: number }[] {
  return shots
    .map((shot, index) => ({ shot, index }))
    .sort((a, b) => {
      const gap = raw(a.shot.at) - raw(b.shot.at);
      return gap !== 0 ? gap : a.index - b.index;
    });
}

export function drawShots(
  shots: readonly ResolvedShot[],
  catalog: Catalog,
  magazine: Magazine,
  options: DrawOptions = {},
): Draw {
  const pull = new Set(
    (options.pull ?? []).map((lot) => lot.trim().toLowerCase()),
  );
  const stock = new WorkingStock(magazine, pull);
  const lines = new Map<string, Working>();
  const drawn = new Map<number, ResolvedShot>();
  const waiting: { shot: ResolvedShot; index: number }[] = [];
  const order = firingOrder(shots);

  for (const entry of order) {
    const line = lineFor(lines, entry.shot.effect);
    line.asked += 1;
    const lot = stock.draw(entry.shot.effect);
    if (lot === undefined) {
      waiting.push(entry);
      continue;
    }
    line.drawn += 1;
    addLot(line.lots, lot);
    drawn.set(entry.index, { ...entry.shot, lot });
  }

  // The candidate list depends on the catalog rather than on the stock, so it
  // is worked out once per effect however many cues went short of it. A finale
  // that is forty shells down would otherwise walk the catalog forty times.
  const candidatesFor = new Map<string, readonly Substitute[]>();
  for (const entry of waiting) {
    const line = lineFor(lines, entry.shot.effect);
    let candidates = candidatesFor.get(entry.shot.effect);
    if (candidates === undefined) {
      candidates = substitutesFor(
        entry.shot.resolved,
        catalog,
        options.substitutes ?? {},
      );
      candidatesFor.set(entry.shot.effect, candidates);
    }
    let taken:
      | { effect: Effect; quality: "exact" | "near"; lot: string }
      | undefined;
    for (const candidate of candidates) {
      const lot = stock.draw(candidate.effect.id);
      if (lot !== undefined) {
        taken = { effect: candidate.effect, quality: candidate.quality, lot };
        break;
      }
    }
    if (taken === undefined) {
      line.uncovered += 1;
      continue;
    }
    const held = line.standIns.get(taken.effect.id);
    if (held === undefined) {
      line.standIns.set(taken.effect.id, {
        standIn: {
          effectId: taken.effect.id,
          effect: taken.effect,
          quality: taken.quality,
          shots: 1,
          lots: [taken.lot],
        },
        lots: [taken.lot],
      });
    } else {
      held.standIn = {
        ...held.standIn,
        shots: held.standIn.shots + 1,
        lots: addLot(held.lots, taken.lot),
      };
    }
    drawn.set(entry.index, {
      ...entry.shot,
      resolved: taken.effect,
      effect: taken.effect.id,
      substitutedFor: entry.shot.effect,
      lot: taken.lot,
    });
  }

  const finished = shots.map((shot, index) => drawn.get(index) ?? shot);
  const report: DrawLine[] = [...lines.values()]
    .map((line) => ({
      effectId: line.effectId,
      asked: line.asked,
      drawn: line.drawn,
      lots: line.lots,
      standIns: [...line.standIns.values()]
        .map((held) => held.standIn)
        .sort((a, b) => compareIds(a.effectId, b.effectId)),
      uncovered: line.uncovered,
    }))
    .sort((a, b) => compareIds(a.effectId, b.effectId));

  return {
    shots: finished,
    lines: report,
    diagnostics: checkDraw(report),
  };
}

/**
 * What to say about a draw. One line per asked for and stand in pair rather
 * than per shot, because forty covered shots are one decision a shooter either
 * accepts or does not, and forty notes about it bury everything else.
 */
export function checkDraw(lines: readonly DrawLine[]): DiagnosticBag {
  const diagnostics = new DiagnosticBag();
  for (const line of lines) {
    for (const standIn of line.standIns) {
      const message = `${standIn.effectId} stands in for ${line.effectId} on ${plural(standIn.shots, "shot")}`;
      if (standIn.quality === "exact") {
        diagnostics.note({
          code: "PF1601",
          message,
          help: `drawn from lot ${standIn.lots.join(", ")}`,
        });
      } else {
        diagnostics.warning({
          code: "PF1602",
          message,
          help: `${standIn.effectId} is a different calibre in the same band, so check the separation`,
        });
      }
    }
    if (line.uncovered > 0) {
      diagnostics.error({
        code: "PF1600",
        message: `the magazine cannot cover ${plural(line.uncovered, "shot")} of ${line.effectId}, and nothing in it can stand in`,
        help: "pull the cue, redesign it, or buy the stock in",
      });
    }
  }
  return diagnostics;
}

/** The line for one effect the script asked for, or nothing. */
export function drawLineFor(
  draw: Draw,
  effectId: string,
): DrawLine | undefined {
  return draw.lines.find((line) => line.effectId === effectId);
}

/** Every shot that fires something other than what the script asked for. */
export function substitutedShots(draw: Draw): readonly ResolvedShot[] {
  return draw.shots.filter((shot) => shot.substitutedFor !== undefined);
}

export function describeDraw(draw: Draw): string {
  const parts: string[] = [];
  for (const line of draw.lines) {
    for (const standIn of line.standIns) {
      parts.push(
        `${line.effectId}: ${plural(standIn.shots, "shot")} fire ${standIn.effectId} from lot ${standIn.lots.join(", ")}`,
      );
    }
    if (line.uncovered > 0) {
      parts.push(
        `${line.effectId}: ${plural(line.uncovered, "shot")} uncovered`,
      );
    }
  }
  return parts.length === 0
    ? "every cue drew the effect it was written for"
    : parts.join("\n");
}
