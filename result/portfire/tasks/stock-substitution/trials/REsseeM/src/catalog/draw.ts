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
 * A show is designed against the house catalog and fired from whatever the
 * store actually holds, and until this stage those two were allowed to
 * disagree in silence. The design said forty six inch palms, the book held
 * thirty, and the firing table came out with forty palms on it anyway. Only
 * `inventory` ever noticed, and it noticed after the table had been written.
 *
 * So the draw happens here, before pins are given out and before anything is
 * checked for separation, because a stand-in is a different shell and the rig
 * and the safety layer have to see the shell that will really go up.
 *
 * Two passes, and the order of them is the whole point. Every cue draws its
 * own effect first, in firing order, so the shells a show was designed with go
 * to the cues that were written first and a shortfall lands at the end of the
 * show rather than wherever the substitution logic happened to look. Only when
 * every cue has had its own turn does the draw go back for the cues left short
 * and lend them something else. Doing it in one pass would let cue three
 * borrow a kamuro that cue forty needed as itself.
 *
 * A lent shell is gone from the store, so one shortfall may be covered by
 * several different stand-ins, and a cue nothing can cover keeps what the
 * script asked for. That last case is an error rather than a silent
 * substitution: the show is not ready, and the crew has to either buy in or
 * rewrite the cue.
 */

export interface DrawOptions {
  /**
   * Lot numbers set aside before the draw. A recall, a case dropped off the
   * tail of the van, or a lot somebody wants held back for another show.
   */
  readonly pull?: readonly string[];
  /** How far the stand-in search may stray. The defaults are the usual ones. */
  readonly substitutes?: SubstituteOptions;
}

/** One asked for effect covered by one stand-in, and how many times. */
export interface Substitution {
  /** What the script asked for. */
  readonly asked: string;
  readonly standIn: string;
  /** Exact when the calibre matches, near when only the handling band does. */
  readonly quality: "exact" | "near";
  readonly count: number;
}

/** An effect the magazine could neither supply nor cover. */
export interface Uncovered {
  readonly effectId: string;
  readonly count: number;
}

export interface Draw {
  /**
   * The shots in script order, each carrying the lot it was drawn from, and
   * the stand-in where one was needed.
   */
  readonly shots: readonly ResolvedShot[];
  readonly substitutions: readonly Substitution[];
  readonly uncovered: readonly Uncovered[];
  /** What the book holds after the draw. The magazine passed in is untouched. */
  readonly remaining: Magazine;
  readonly diagnostics: DiagnosticBag;
}

/** A lot number as the magazine book writes it, so a flag can be typed loosely. */
export function normaliseLot(lotNumber: string): string {
  return lotNumber.trim().toLowerCase();
}

interface Taken {
  readonly lot: string;
  readonly standIn?: Substitute;
}

export function drawShots(
  shots: readonly ResolvedShot[],
  catalog: Catalog,
  magazine: Magazine,
  options: DrawOptions = {},
): Draw {
  const remaining = magazine.copy();
  for (const lotNumber of options.pull ?? []) {
    remaining.quarantine(normaliseLot(lotNumber));
  }

  // Firing order is visible time first and script order within a time, which
  // is the order a crew reads the cue sheet in. Sort is stable, so keeping the
  // script index is enough to hold the second half of that.
  const order = shots
    .map((shot, index) => ({ shot, index }))
    .sort((a, b) => raw(a.shot.at) - raw(b.shot.at) || a.index - b.index);

  const taken = new Map<number, Taken>();
  const short: { shot: ResolvedShot; index: number }[] = [];
  for (const entry of order) {
    const lot = remaining.draw(entry.shot.resolved.id);
    if (lot === undefined) {
      short.push(entry);
    } else {
      taken.set(entry.index, { lot });
    }
  }

  const candidates = new Map<string, Substitute[]>();
  const substitutions = new Map<string, Substitution>();
  const uncovered = new Map<string, number>();

  for (const entry of short) {
    const wanted = entry.shot.resolved;
    let offered = candidates.get(wanted.id);
    if (offered === undefined) {
      offered = substitutesFor(wanted, catalog, options.substitutes ?? {});
      candidates.set(wanted.id, offered);
    }
    let covered: Substitute | undefined;
    let lot: string | undefined;
    for (const candidate of offered) {
      const drawn = remaining.draw(candidate.effect.id);
      if (drawn !== undefined) {
        covered = candidate;
        lot = drawn;
        break;
      }
    }
    if (covered === undefined || lot === undefined) {
      uncovered.set(wanted.id, (uncovered.get(wanted.id) ?? 0) + 1);
      continue;
    }
    taken.set(entry.index, { lot, standIn: covered });
    const key = `${wanted.id}\u0000${covered.effect.id}`;
    const already = substitutions.get(key);
    substitutions.set(key, {
      asked: wanted.id,
      standIn: covered.effect.id,
      quality: covered.quality,
      count: (already?.count ?? 0) + 1,
    });
  }

  const drawn = shots.map((shot, index) => {
    const entry = taken.get(index);
    if (entry === undefined) {
      // Nothing covered it, so the shot keeps what was written. The table is
      // still the table the show asked for, and the error says why it cannot
      // be fired as it stands.
      return shot;
    }
    if (entry.standIn === undefined) {
      return { ...shot, lot: entry.lot };
    }
    return {
      ...shot,
      effect: entry.standIn.effect.id,
      resolved: entry.standIn.effect,
      lot: entry.lot,
      substitutedFor: shot.effect,
    };
  });

  const madeGood = [...substitutions.values()].sort(
    (a, b) => compareIds(a.asked, b.asked) || compareIds(a.standIn, b.standIn),
  );
  const left = [...uncovered.entries()]
    .sort((a, b) => compareIds(a[0], b[0]))
    .map(([effectId, count]) => ({ effectId, count }));

  return {
    shots: drawn,
    substitutions: madeGood,
    uncovered: left,
    remaining,
    diagnostics: checkDraw(madeGood, left),
  };
}

/**
 * What the draw has to say. One line per pair rather than per cue, because a
 * finale short of thirty shells would otherwise bury everything else in the
 * report, and the crew acts on the pair, not on each cue.
 */
export function checkDraw(
  substitutions: readonly Substitution[],
  uncovered: readonly Uncovered[],
): DiagnosticBag {
  const diagnostics = new DiagnosticBag();
  for (const made of substitutions) {
    const message = `${made.asked} short ${made.count}, firing ${made.standIn} instead`;
    if (made.quality === "exact") {
      diagnostics.note({
        code: "PF1601",
        message,
        help: `${made.standIn} is the same calibre, so the lift and the separation are unchanged`,
      });
    } else {
      diagnostics.warning({
        code: "PF1602",
        message,
        help: `${made.standIn} is a different calibre in the same band, so check the separation`,
      });
    }
  }
  for (const line of uncovered) {
    diagnostics.error({
      code: "PF1600",
      message: `nothing in the magazine can stand in for ${line.effectId}, ${plural(line.count, "cue")} left short`,
      help: "redesign the cue, or buy in",
    });
  }
  return diagnostics;
}

/** How many cues the draw covered with something other than what was written. */
export function substitutedCount(draw: Draw): number {
  return draw.substitutions.reduce((total, made) => total + made.count, 0);
}

/** How many cues nothing could cover. */
export function uncoveredCount(draw: Draw): number {
  return draw.uncovered.reduce((total, line) => total + line.count, 0);
}

/** A line for the top of a report, in the same voice as the compile summary. */
export function summariseDraw(draw: Draw): string {
  const substituted = substitutedCount(draw);
  const short = uncoveredCount(draw);
  if (substituted === 0 && short === 0) {
    return "every cue drawn from stock as written";
  }
  const parts: string[] = [];
  if (substituted > 0) {
    parts.push(`${plural(substituted, "cue")} stood in for`);
  }
  if (short > 0) {
    parts.push(`${plural(short, "cue")} left short`);
  }
  return parts.join(", ");
}
