import type { Effect } from "./effect.js";
import type { Lot, Magazine } from "./inventory.js";
import { setAside } from "./inventory.js";
import type { Catalog } from "./registry.js";
import { substitutesFor } from "./substitute.js";
import type { Substitute } from "./substitute.js";
import { DiagnosticBag } from "../core/diagnostic.js";
import { compareIds } from "../core/ids.js";
import type { Span } from "../core/span.js";
import { raw } from "../core/units.js";
import type { ResolvedShot } from "../script/resolve.js";

/**
 * Drawing a show out of the magazine.
 *
 * A show is designed against the house catalog, which is a list of everything
 * the company has ever bought. It is fired from the magazine, which is what is
 * on the shelf this week. Resolving a script against the catalog and then
 * hoping the shelf agrees is how a crew ends up on the field with a firing
 * table that calls for thirty six inch palms and twenty two in the store.
 *
 * So the draw happens in the compiler, before pins are allocated and before
 * anything is checked, and what comes out is a shot list of shells that exist.
 * Two rules make the result the one a shooter would have chosen by hand:
 *
 * Every cue gets its own shell before any cue gets a substitute. Drawing in
 * one pass would let cue three take the last palm as a stand-in while cue
 * forty, which actually asked for a palm, went without.
 *
 * A shell lent to one cue is gone. One shortfall can therefore span several
 * stand-ins, and the second stand-in is chosen knowing the first is spent,
 * which is exactly what happens when somebody works down the shortfall with
 * the store list in front of them.
 */

export interface DrawOptions {
  /**
   * Lot numbers set aside before the draw: a recall, or stock promised to
   * another show. They are gone for the whole draw rather than skipped per
   * cue, because a quarantined lot is not on the shelf at all.
   */
  readonly pull?: readonly string[];
}

/** One asked for effect, one stand-in, and how many cues it covered. */
export interface Substitution {
  /** What the script wrote. */
  readonly asked: string;
  /** What will be loaded into the mortar. */
  readonly standIn: string;
  readonly effect: Effect;
  /** Exact when the calibre matches, near when only the handling band does. */
  readonly quality: "exact" | "near";
  readonly count: number;
  readonly leadDifferenceMs: number;
  /** The first cue the swap applies to, for the diagnostic to point at. */
  readonly origin?: Span;
}

/** An effect no amount of standing in could cover. */
export interface DrawShortLine {
  readonly effectId: string;
  readonly short: number;
  readonly origin?: Span;
}

export interface ShowDraw {
  /**
   * The shot list as drawn: same cues, same times, with a stand-in where one
   * was needed and the lot written on every shot that found stock.
   */
  readonly shots: readonly ResolvedShot[];
  readonly substitutions: readonly Substitution[];
  readonly short: readonly DrawShortLine[];
  /** What is left on the shelf after the show is drawn. */
  readonly remaining: Magazine;
  readonly diagnostics: DiagnosticBag;
}

/** Firing order: when the audience sees it, then the order it was written. */
function firingOrder(
  shots: readonly ResolvedShot[],
): { shot: ResolvedShot; index: number }[] {
  return shots
    .map((shot, index) => ({ shot, index }))
    .sort((a, b) => raw(a.shot.at) - raw(b.shot.at) || a.index - b.index);
}

interface Taken {
  readonly substitute: Substitute;
  readonly lot: Lot;
}

/**
 * Work down the candidate list until one of them is actually in stock. The
 * list is what `substitutesFor` offers with its own defaults, so the order is
 * the same calibre ahead of a band match, the nearest flight time next, and
 * the name last.
 */
function borrow(
  candidates: readonly Substitute[],
  magazine: Magazine,
): Taken | undefined {
  for (const substitute of candidates) {
    const lot = magazine.issue(substitute.effect.id);
    if (lot !== undefined) {
      return { substitute, lot };
    }
  }
  return undefined;
}

export function drawShow(
  shots: readonly ResolvedShot[],
  catalog: Catalog,
  magazine: Magazine,
  options: DrawOptions = {},
): ShowDraw {
  const remaining = setAside(magazine, options.pull ?? []);
  const drawn = [...shots];
  const outstanding: { shot: ResolvedShot; index: number }[] = [];

  // First pass: everything takes its own effect while the stock lasts, so a
  // late cue is the one that goes without rather than a random one.
  for (const entry of firingOrder(shots)) {
    const lot = remaining.issue(entry.shot.resolved.id);
    if (lot === undefined) {
      outstanding.push(entry);
      continue;
    }
    drawn[entry.index] = { ...entry.shot, lot: lot.lotNumber };
  }

  // Second pass: cover what is left, in the same order.
  const candidates = new Map<string, readonly Substitute[]>();
  const swaps = new Map<string, Substitution>();
  const short = new Map<string, DrawShortLine>();

  for (const entry of outstanding) {
    const asked = entry.shot.resolved;
    let offered = candidates.get(asked.id);
    if (offered === undefined) {
      offered = substitutesFor(asked, catalog);
      candidates.set(asked.id, offered);
    }
    const taken = borrow(offered, remaining);
    if (taken === undefined) {
      // Nothing covers it, so the cue keeps what was written. A show that
      // silently dropped the cue would compile clean and fire short.
      const line = short.get(asked.id);
      short.set(asked.id, {
        effectId: asked.id,
        short: (line?.short ?? 0) + 1,
        ...(line?.origin === undefined
          ? { origin: entry.shot.origin }
          : { origin: line.origin }),
      });
      continue;
    }
    const standIn = taken.substitute.effect;
    drawn[entry.index] = {
      ...entry.shot,
      effect: standIn.id,
      resolved: standIn,
      substitutedFor: entry.shot.effect,
      lot: taken.lot.lotNumber,
    };
    const key = `${asked.id}\u0000${standIn.id}`;
    const already = swaps.get(key);
    swaps.set(
      key,
      already === undefined
        ? {
            asked: asked.id,
            standIn: standIn.id,
            effect: standIn,
            quality: taken.substitute.quality,
            count: 1,
            leadDifferenceMs: taken.substitute.leadDifferenceMs,
            origin: entry.shot.origin,
          }
        : { ...already, count: already.count + 1 },
    );
  }

  const substitutions = [...swaps.values()].sort(
    (a, b) => compareIds(a.asked, b.asked) || compareIds(a.standIn, b.standIn),
  );
  const shortLines = [...short.values()].sort((a, b) =>
    compareIds(a.effectId, b.effectId),
  );
  return {
    shots: drawn,
    substitutions,
    short: shortLines,
    remaining,
    diagnostics: checkDraw(substitutions, shortLines),
  };
}

/**
 * What the draw has to say for itself. One line per pair rather than per shot,
 * because a forty shot ripple covered by one stand-in is one decision and
 * forty identical notes would bury everything else in the report.
 */
export function checkDraw(
  substitutions: readonly Substitution[],
  short: readonly DrawShortLine[],
): DiagnosticBag {
  const diagnostics = new DiagnosticBag();
  for (const line of short) {
    diagnostics.error({
      code: "PF1600",
      message: `the magazine is ${line.short} short of ${line.effectId} and nothing in stock can stand in`,
      ...(line.origin === undefined ? {} : { span: line.origin }),
      help: "redesign the cue, or buy in",
    });
  }
  for (const swap of substitutions) {
    const message = `${swap.asked} short ${swap.count}, drawn as ${swap.standIn}`;
    if (swap.quality === "exact") {
      diagnostics.note({
        code: "PF1601",
        message,
        ...(swap.origin === undefined ? {} : { span: swap.origin }),
      });
    } else {
      diagnostics.warning({
        code: "PF1602",
        message,
        ...(swap.origin === undefined ? {} : { span: swap.origin }),
        help: `${swap.standIn} is a different calibre in the same band, so check the separation`,
      });
    }
  }
  return diagnostics;
}

/** How many shots came out of each lot, which is what the paperwork wants. */
export function lotsUsed(shots: readonly ResolvedShot[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const shot of shots) {
    if (shot.lot !== undefined) {
      counts.set(shot.lot, (counts.get(shot.lot) ?? 0) + 1);
    }
  }
  return counts;
}

/** A line a crew can read, for a report that is not a diagnostic list. */
export function describeDraw(draw: ShowDraw): string {
  const swapped = draw.substitutions.reduce(
    (total, swap) => total + swap.count,
    0,
  );
  const missing = draw.short.reduce((total, line) => total + line.short, 0);
  const parts = [
    `${draw.shots.length - swapped - missing} drawn as written`,
    `${swapped} substituted`,
    `${missing} not covered`,
  ];
  return parts.join(", ");
}
