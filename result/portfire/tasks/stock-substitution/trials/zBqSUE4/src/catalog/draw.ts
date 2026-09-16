import type { Lot, Magazine } from "./inventory.js";
import type { Catalog } from "./registry.js";
import type { Substitute } from "./substitute.js";
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
 * magazine book says is on the shelf, and those two are never the same thing.
 * Up to here the compiler has believed the catalog, which is fine for timing
 * and for separation but not for the question the crew asks on the morning of
 * the load: which case does this cue come out of, and what do we fire when the
 * case is empty.
 *
 * So the draw walks the show in firing order and takes one unit per shot.
 * Firing order rather than script order because the shells that go up first
 * are the ones that get the stock; a cue in the finale cannot take a shell out
 * of the opener's hand. Every cue draws its own effect first, and only once the
 * whole show has had that chance does anything reach for a stand-in. Doing it
 * the other way round would let an early cue borrow a stand-in that a later cue
 * needed as its own.
 *
 * A stand-in is drawn from stock like anything else, so it is gone once lent.
 * One shortfall can therefore end up spread across several stand-ins, which is
 * exactly what happens on the field when the crew empties one case and opens
 * the next thing that will do.
 *
 * Nothing here touches the book it was handed. The magazine is a legal record
 * of what is held, not a running total of what a compile has imagined
 * spending, and a crew comparing two versions of a show has to be able to
 * compile both against the same book.
 */

/** A lot with what is left of it, as the draw works down the shelf. */
interface Held {
  readonly lotNumber: string;
  readonly received?: string;
  left: number;
}

export interface DrawOptions {
  /**
   * Lot numbers set aside before the draw starts, which is what a recall or a
   * damaged case means. They are gone for this show without being struck from
   * the book.
   */
  readonly pull?: readonly string[];
}

/** One asked-for effect and one stand-in, with how many cues it covered. */
export interface DrawSubstitution {
  readonly wanted: string;
  readonly used: string;
  /** Exact when the calibre matches, near when only the handling band does. */
  readonly quality: "exact" | "near";
  readonly count: number;
  /** The lots the stand-ins came out of, in the order they were drawn. */
  readonly lots: readonly string[];
}

/** An effect that ran out and had nothing to stand in for it. */
export interface DrawShortfall {
  readonly effectId: string;
  readonly short: number;
}

export interface DrawResult {
  /**
   * The show as it will actually be fired, in script order. A shot that drew
   * its own effect carries the lot; a shot covered by a stand-in carries the
   * stand-in as its effect and says what it was written as.
   */
  readonly shots: readonly ResolvedShot[];
  readonly substitutions: readonly DrawSubstitution[];
  readonly shortfalls: readonly DrawShortfall[];
  /** How many units the pull list set aside before the draw. */
  readonly pulled: number;
  readonly diagnostics: DiagnosticBag;
}

/**
 * Which lot to open first: the oldest stock, because shells do not improve on
 * a shelf and a lot with no date on it is the one nobody can vouch for, so it
 * goes last rather than first. Two lots received the same day are separated by
 * lot number, which is arbitrary but has to be decided somewhere or the same
 * show draws different lots on two machines.
 */
function compareLots(a: Held, b: Held): number {
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

/** A working copy of the shelf, keyed by effect, that the draw can spend. */
function shelfFrom(
  magazine: Magazine,
  pull: readonly string[],
): { readonly shelf: Map<string, Held[]>; readonly pulled: number } {
  const aside = new Set(
    pull.map((lotNumber) => lotNumber.trim().toLowerCase()),
  );
  const shelf = new Map<string, Held[]>();
  let pulled = 0;
  for (const line of magazine.stock()) {
    const held: Held[] = [];
    for (const lot of line.lots) {
      if (aside.has(lot.lotNumber.toLowerCase())) {
        pulled += lot.quantity;
        continue;
      }
      held.push(heldFrom(lot));
    }
    shelf.set(line.effectId, held.sort(compareLots));
  }
  return { shelf, pulled };
}

function heldFrom(lot: Lot): Held {
  return {
    lotNumber: lot.lotNumber,
    ...(lot.received === undefined ? {} : { received: lot.received }),
    left: lot.quantity,
  };
}

/** Take one unit of an effect, returning the lot it came out of. */
function take(
  shelf: Map<string, Held[]>,
  effectId: string,
): string | undefined {
  for (const held of shelf.get(effectId) ?? []) {
    if (held.left > 0) {
      held.left -= 1;
      return held.lotNumber;
    }
  }
  return undefined;
}

export function drawShots(
  shots: readonly ResolvedShot[],
  catalog: Catalog,
  magazine: Magazine,
  options: DrawOptions = {},
): DrawResult {
  const diagnostics = new DiagnosticBag();
  const { shelf, pulled } = shelfFrom(magazine, options.pull ?? []);
  const drawn: ResolvedShot[] = [...shots];

  // Firing order is the visible time, and script order settles a tie, so two
  // cues written on the same beat draw in the order somebody typed them.
  const order = shots
    .map((shot, index) => ({ shot, index }))
    .sort((a, b) => raw(a.shot.at) - raw(b.shot.at) || a.index - b.index);

  const short: { readonly shot: ResolvedShot; readonly index: number }[] = [];
  for (const { shot, index } of order) {
    const lot = take(shelf, shot.effect);
    if (lot === undefined) {
      short.push({ shot, index });
      continue;
    }
    drawn[index] = { ...shot, lot };
  }

  const pairs = new Map<string, DrawSubstitution & { lots: string[] }>();
  const missing = new Map<string, number>();
  const offers = new Map<string, readonly Substitute[]>();

  for (const { shot, index } of short) {
    let candidates = offers.get(shot.effect);
    if (candidates === undefined) {
      candidates = substitutesFor(shot.resolved, catalog);
      offers.set(shot.effect, candidates);
    }
    // One candidate at a time, and only the one that supplies is charged for
    // it. Asking the whole list first would empty every shelf on it.
    let covered:
      | { readonly candidate: Substitute; readonly lot: string }
      | undefined;
    for (const candidate of candidates) {
      const lot = take(shelf, candidate.effect.id);
      if (lot !== undefined) {
        covered = { candidate, lot };
        break;
      }
    }
    if (covered === undefined) {
      // Left as written, because a cue sheet that quietly dropped the shell it
      // was designed with would be read as the design.
      missing.set(shot.effect, (missing.get(shot.effect) ?? 0) + 1);
      continue;
    }
    const used = covered.candidate.effect;
    drawn[index] = {
      ...shot,
      effect: used.id,
      resolved: used,
      substitutedFor: shot.effect,
      lot: covered.lot,
    };
    const key = `${shot.effect} ${used.id}`;
    const already = pairs.get(key);
    if (already === undefined) {
      pairs.set(key, {
        wanted: shot.effect,
        used: used.id,
        quality: covered.candidate.quality,
        count: 1,
        lots: [covered.lot],
      });
    } else {
      pairs.set(key, {
        ...already,
        count: already.count + 1,
        lots: [...already.lots, covered.lot],
      });
    }
  }

  const substitutions = [...pairs.values()].sort(
    (a, b) => compareIds(a.wanted, b.wanted) || compareIds(a.used, b.used),
  );
  const shortfalls = [...missing.entries()]
    .map(([effectId, count]) => ({ effectId, short: count }))
    .sort((a, b) => compareIds(a.effectId, b.effectId));

  for (const swap of substitutions) {
    const message = `${swap.wanted} short ${swap.count}, use ${swap.used}`;
    if (swap.quality === "exact") {
      diagnostics.note({ code: "PF1601", message });
    } else {
      diagnostics.warning({
        code: "PF1602",
        message,
        help: `${swap.used} is a different calibre in the same band, so check the separation`,
      });
    }
  }
  for (const line of shortfalls) {
    diagnostics.error({
      code: "PF1600",
      message: `nothing in stock can stand in for ${line.effectId}`,
      help: `${plural(line.short, "cue")} keep it as written, so redesign or buy in`,
    });
  }

  return { shots: drawn, substitutions, shortfalls, pulled, diagnostics };
}

/** A one line account of a draw, for the top of a report. */
export function describeDraw(result: DrawResult): string {
  const parts: string[] = [];
  const swapped = result.substitutions.reduce(
    (total, swap) => total + swap.count,
    0,
  );
  const short = result.shortfalls.reduce(
    (total, line) => total + line.short,
    0,
  );
  parts.push(
    `${plural(result.shots.length - swapped - short, "cue")} as written`,
  );
  if (swapped > 0) {
    parts.push(`${plural(swapped, "cue")} on a stand-in`);
  }
  if (short > 0) {
    parts.push(`${plural(short, "cue")} with nothing to fire`);
  }
  if (result.pulled > 0) {
    parts.push(`${plural(result.pulled, "unit")} pulled`);
  }
  return parts.join(", ");
}
