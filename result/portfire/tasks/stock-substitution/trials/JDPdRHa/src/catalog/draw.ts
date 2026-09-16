import type { Lot, Magazine } from "./inventory.js";
import type { Catalog } from "./registry.js";
import { substitutesFor } from "./substitute.js";
import type { Substitute } from "./substitute.js";
import { DiagnosticBag } from "../core/diagnostic.js";
import { compareIds } from "../core/ids.js";
import { plural } from "../core/text.js";
import { raw } from "../core/units.js";
import type { ResolvedShot } from "../script/resolve.js";

/**
 * Drawing the show out of the magazine.
 *
 * A show is designed against the house catalog and fired out of whatever the
 * magazine holds, and the gap between those two is the ordinary state of
 * affairs rather than an emergency. Up to here the compiler has been working
 * from the catalog alone, which means it has been quietly assuming an infinite
 * supply of every shell the script names. Hand it the book and the assumption
 * goes away: each cue draws a real unit from a real lot, and a cue the stock
 * cannot reach has to be covered by something else or admitted to.
 *
 * The order matters more than it looks. Drawing in firing order means the
 * shells go to the cues at the front of the show and the shortfall lands at the
 * back, which is where a crew would rather have it, because the end of a show
 * is the part that can be rewritten on the day. And every cue draws what it
 * was written for before any cue is offered a stand-in, so a substitution
 * never takes a shell out from under a cue that asked for it by name.
 *
 * The book itself is never touched. A draw is a plan, not a movement of stock,
 * and the same book has to give the same answer for the next show the crew
 * compiles against it.
 */

export interface DrawOptions {
  /**
   * Lot numbers set aside before the draw, which is what a recall or a
   * damaged case means. They are gone for the whole show rather than counted
   * and skipped, because a lot under quarantine is not stock.
   */
  readonly pull?: Iterable<string>;
}

/** One asked for effect covered by one stand-in, and what it cost. */
export interface StandIn {
  /** What the script asked for. */
  readonly wanted: string;
  readonly substitute: string;
  /** Exact when the calibre matches, near when only the handling band does. */
  readonly quality: "exact" | "near";
  /** How many cues the stand-in covers. */
  readonly shots: number;
  /** The lots those cues draw from, in the order they were drawn. */
  readonly lots: readonly string[];
}

/** An effect the magazine could not cover, even with stand-ins. */
export interface ShortDraw {
  readonly effectId: string;
  /** How many cues are left holding what the script wrote. */
  readonly short: number;
}

export interface Draw {
  /** Every shot, in the order it came in, with what it actually fires. */
  readonly shots: readonly ResolvedShot[];
  readonly standIns: readonly StandIn[];
  readonly short: readonly ShortDraw[];
  readonly diagnostics: DiagnosticBag;
}

/** A lot with a running count, so the draw can spend it without spending stock. */
interface Held {
  readonly lotNumber: string;
  readonly received?: string;
  left: number;
}

/**
 * Oldest first, which is how a magazine is worked through: stock that has sat
 * longest goes out first. A lot with no received date sorts last rather than
 * first, because an undated row is usually an old one somebody never wrote up
 * and guessing it is the oldest would send it out ahead of stock that is known
 * to be older.
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

function heldFrom(lots: readonly Lot[], pull: ReadonlySet<string>): Held[] {
  return lots
    .filter((lot) => !pull.has(lot.lotNumber.toLowerCase()))
    .map((lot) => ({
      lotNumber: lot.lotNumber,
      ...(lot.received === undefined ? {} : { received: lot.received }),
      left: lot.quantity,
    }))
    .sort(compareHeld);
}

/**
 * What the magazine can spend, as a working copy. Everything the draw does
 * happens to this rather than to the book.
 */
function workingStock(
  magazine: Magazine,
  pull: ReadonlySet<string>,
): Map<string, Held[]> {
  const stock = new Map<string, Held[]>();
  for (const line of magazine.stock()) {
    stock.set(line.effectId, heldFrom(line.lots, pull));
  }
  return stock;
}

/** Take one unit and say which lot it came from, or nothing if there is none. */
function takeOne(
  stock: Map<string, Held[]>,
  effectId: string,
): string | undefined {
  for (const held of stock.get(effectId) ?? []) {
    if (held.left > 0) {
      held.left -= 1;
      return held.lotNumber;
    }
  }
  return undefined;
}

/** Cues in the order the panel fires them, ties settled by the script. */
function firingOrder(
  shots: readonly ResolvedShot[],
): { shot: ResolvedShot; at: number }[] {
  return shots
    .map((shot, at) => ({ shot, at }))
    .sort((a, b) => raw(a.shot.at) - raw(b.shot.at) || a.at - b.at);
}

export function drawShots(
  shots: readonly ResolvedShot[],
  catalog: Catalog,
  magazine: Magazine,
  options: DrawOptions = {},
): Draw {
  const pull = new Set(
    [...(options.pull ?? [])].map((lotNumber) => lotNumber.toLowerCase()),
  );
  const stock = workingStock(magazine, pull);
  const ordered = firingOrder(shots);
  const drawn: ResolvedShot[] = [...shots];
  const owed: { shot: ResolvedShot; at: number }[] = [];

  // Every cue takes what it was written for first. A cue that cannot is left
  // for the second pass rather than covered now, so the shells go to the cues
  // that named them.
  for (const { shot, at } of ordered) {
    const lot = takeOne(stock, shot.effect);
    if (lot === undefined) {
      owed.push({ shot, at });
      continue;
    }
    drawn[at] = { ...shot, lot };
  }

  const candidates = new Map<string, readonly Substitute[]>();
  const standIns = new Map<string, StandIn & { lots: string[] }>();
  const short = new Map<string, number>();

  for (const { shot, at } of owed) {
    let taken: { substitute: Substitute; lot: string } | undefined;
    let offers = candidates.get(shot.effect);
    if (offers === undefined) {
      offers = substitutesFor(shot.resolved, catalog);
      candidates.set(shot.effect, offers);
    }
    for (const offer of offers) {
      const lot = takeOne(stock, offer.effect.id);
      if (lot !== undefined) {
        taken = { substitute: offer, lot };
        break;
      }
    }
    if (taken === undefined) {
      short.set(shot.effect, (short.get(shot.effect) ?? 0) + 1);
      continue;
    }
    drawn[at] = {
      ...shot,
      effect: taken.substitute.effect.id,
      resolved: taken.substitute.effect,
      substitutedFor: shot.effect,
      lot: taken.lot,
    };
    const key = `${shot.effect}\u0000${taken.substitute.effect.id}`;
    const already = standIns.get(key);
    if (already === undefined) {
      standIns.set(key, {
        wanted: shot.effect,
        substitute: taken.substitute.effect.id,
        quality: taken.substitute.quality,
        shots: 1,
        lots: [taken.lot],
      });
    } else {
      standIns.set(key, {
        ...already,
        shots: already.shots + 1,
        lots: already.lots.includes(taken.lot)
          ? already.lots
          : [...already.lots, taken.lot],
      });
    }
  }

  const lines = [...standIns.values()].sort(
    (a, b) =>
      compareIds(a.wanted, b.wanted) || compareIds(a.substitute, b.substitute),
  );
  const missing = [...short.entries()]
    .sort((a, b) => compareIds(a[0], b[0]))
    .map(([effectId, count]) => ({ effectId, short: count }));

  return {
    shots: drawn,
    standIns: lines,
    short: missing,
    diagnostics: checkDraw(lines, missing),
  };
}

function lotPhrase(lots: readonly string[]): string {
  return `${lots.length === 1 ? "lot" : "lots"} ${lots.join(", ")}`;
}

/**
 * What the draw has to say for itself.
 *
 * A stand-in of the same calibre is a note, because nothing downstream
 * changes: the timing, the separation and the mortar are the same and the only
 * difference is what the audience sees. A stand-in in the same band is a
 * warning, because the calibre moved and the separation was worked out from
 * the calibre. A cue nothing covers is an error, because the table would
 * otherwise say to load a shell that is not in the store.
 */
export function checkDraw(
  standIns: readonly StandIn[],
  short: readonly ShortDraw[],
): DiagnosticBag {
  const diagnostics = new DiagnosticBag();
  for (const line of standIns) {
    const message = `${line.wanted} short, ${plural(line.shots, "cue")} drawn as ${line.substitute}`;
    const from = `drawn from ${lotPhrase(line.lots)}`;
    if (line.quality === "exact") {
      diagnostics.note({
        code: "PF1601",
        message,
        help: `${line.substitute} is the same calibre, so only the look changes, ${from}`,
      });
      continue;
    }
    diagnostics.warning({
      code: "PF1602",
      message,
      help: `${line.substitute} is a different calibre in the same band, so check the separation, ${from}`,
    });
  }
  for (const line of short) {
    diagnostics.error({
      code: "PF1600",
      message: `nothing in stock can stand in for ${line.effectId}, ${plural(line.short, "cue")} left as written`,
      help: "redesign the cue, or buy in",
    });
  }
  return diagnostics;
}

/** A one line verdict on a draw, for the top of a report. */
export function describeDraw(draw: Draw): string {
  const substituted = draw.shots.filter(
    (shot) => shot.substitutedFor !== undefined,
  ).length;
  const uncovered = draw.short.reduce((total, line) => total + line.short, 0);
  const asWritten = draw.shots.length - substituted - uncovered;
  const parts = [`${asWritten} of ${draw.shots.length} drawn as written`];
  if (substituted > 0) {
    parts.push(
      `${substituted} covered by ${plural(draw.standIns.length, "stand-in")}`,
    );
  }
  if (uncovered > 0) {
    parts.push(`${uncovered} not covered at all`);
  }
  return parts.join(", ");
}
