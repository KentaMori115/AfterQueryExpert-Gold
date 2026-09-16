import type { Lot } from "./inventory.js";
import type { Magazine } from "./inventory.js";
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
 * A display is designed against a catalog and fired out of whatever the store
 * actually holds, and those two disagree by the afternoon of the show. Up to
 * now portfire would count the difference and stop, which leaves the crew to
 * work out by hand which cue gets which shell and then to edit the script to
 * match. That edit is the part that goes wrong, because it happens last and in
 * a hurry.
 *
 * So the draw is done here, in firing order, and it follows the order a crew
 * would work in rather than anything cleverer:
 *
 * Every cue takes what the script asked for while there is stock, earliest cue
 * first, so a shortfall lands on the end of the show rather than on the
 * opening shell. Only when every cue has had its own turn does anything get a
 * stand in, in the same order. That second pass matters: a cue that could have
 * had the real thing must never be handed a substitute because a later cue
 * spent the stock first.
 *
 * A shell lent to one cue is gone, so one shortfall can span several stand ins
 * and the second choice is drawn against what is left after the first. A cue
 * nothing can cover keeps what was written, which leaves the show not ready
 * and says so, because quietly firing something else is worse than stopping.
 */

export interface StandIn {
  /** What the script asked for. */
  readonly askedFor: string;
  /** What went up instead. */
  readonly effectId: string;
  /** Exact when the calibre matches, near when only the handling band does. */
  readonly quality: "exact" | "near";
  /** How many cues it covered. */
  readonly shots: number;
  /** The lots it came out of, in the order they were drawn. */
  readonly lots: readonly string[];
}

/** An effect the draw could neither find nor cover. */
export interface ShortDraw {
  readonly effectId: string;
  /** Cues left holding what the script wrote. */
  readonly shots: number;
}

export interface Draw {
  /** The shots as they will actually fire, stand ins in place. */
  readonly shots: readonly ResolvedShot[];
  readonly standIns: readonly StandIn[];
  readonly short: readonly ShortDraw[];
  /** What is left in the store after the show has been drawn out of it. */
  readonly remaining: Magazine;
  readonly diagnostics: DiagnosticBag;
}

export interface DrawOptions {
  /**
   * Lot numbers to set aside before anything is drawn, which is what a recall
   * or a damaged case means. They are pulled from the copy, so the book that
   * was handed in still says what the store was told to hold.
   */
  readonly pull?: readonly string[];
}

interface Waiting {
  readonly shot: ResolvedShot;
  readonly index: number;
}

/** Firing order: when the audience sees it, then where it sits in the script. */
function firingOrder(shots: readonly ResolvedShot[]): Waiting[] {
  return shots
    .map((shot, index) => ({ shot, index }))
    .sort((a, b) => {
      const gap = raw(a.shot.at) - raw(b.shot.at);
      return gap !== 0 ? gap : a.index - b.index;
    });
}

export function drawStock(
  shots: readonly ResolvedShot[],
  catalog: Catalog,
  magazine: Magazine,
  options: DrawOptions = {},
): Draw {
  const remaining = magazine.copy();
  for (const lotNumber of options.pull ?? []) {
    remaining.quarantine(lotNumber);
  }

  const drawn = [...shots];
  const waiting: Waiting[] = [];

  for (const entry of firingOrder(shots)) {
    const lot = remaining.issue(entry.shot.effect);
    if (lot === undefined) {
      waiting.push(entry);
      continue;
    }
    drawn[entry.index] = { ...entry.shot, lot: lot.lotNumber };
  }

  const standIns = new Map<string, StandIn>();
  const short = new Map<string, number>();
  const offers = new Map<string, readonly Substitute[]>();

  for (const entry of waiting) {
    const askedFor = entry.shot.effect;
    let candidates = offers.get(askedFor);
    if (candidates === undefined) {
      candidates = substitutesFor(entry.shot.resolved, catalog);
      offers.set(askedFor, candidates);
    }
    const taken = firstInStock(candidates, remaining);
    if (taken === undefined) {
      short.set(askedFor, (short.get(askedFor) ?? 0) + 1);
      continue;
    }
    const standIn = taken.substitute.effect;
    drawn[entry.index] = {
      ...entry.shot,
      effect: standIn.id,
      resolved: standIn,
      substitutedFor: askedFor,
      lot: taken.lot.lotNumber,
    };
    record(standIns, askedFor, taken);
  }

  const stood = [...standIns.values()].sort(
    (a, b) =>
      compareIds(a.askedFor, b.askedFor) || compareIds(a.effectId, b.effectId),
  );
  const left = [...short.entries()]
    .sort((a, b) => compareIds(a[0], b[0]))
    .map(([effectId, count]) => ({ effectId, shots: count }));

  return {
    shots: drawn,
    standIns: stood,
    short: left,
    remaining,
    diagnostics: checkDraw(stood, left),
  };
}

interface Taken {
  readonly substitute: Substitute;
  readonly lot: Lot;
}

/**
 * The best candidate the store can still supply. The list is already in the
 * order a designer would read it, so this is only the stock check, and it is
 * done a unit at a time because the unit is drawn as soon as it is found.
 */
function firstInStock(
  candidates: readonly Substitute[],
  remaining: Magazine,
): Taken | undefined {
  for (const substitute of candidates) {
    const lot = remaining.issue(substitute.effect.id);
    if (lot !== undefined) {
      return { substitute, lot };
    }
  }
  return undefined;
}

function record(
  standIns: Map<string, StandIn>,
  askedFor: string,
  taken: Taken,
): void {
  const stood = taken.substitute.effect;
  const key = `${askedFor} ${stood.id}`;
  const held = standIns.get(key);
  standIns.set(key, {
    askedFor,
    effectId: stood.id,
    quality: taken.substitute.quality,
    shots: (held?.shots ?? 0) + 1,
    lots: [...(held?.lots ?? []), taken.lot.lotNumber],
  });
}

/**
 * What the draw has to say for itself. A calibre for calibre swap is a note,
 * because nothing about the show changed except the label. A swap inside the
 * handling band is a warning, because the separation distance was worked out
 * for the calibre that was written down. A cue nothing covers is an error.
 */
export function checkDraw(
  standIns: readonly StandIn[],
  short: readonly ShortDraw[],
): DiagnosticBag {
  const diagnostics = new DiagnosticBag();
  for (const stood of standIns) {
    const message = `${plural(stood.shots, "cue")} of ${stood.askedFor} drawn as ${stood.effectId}`;
    if (stood.quality === "exact") {
      diagnostics.note({
        code: "PF1601",
        message,
        help: `from ${describeLots(stood.lots)}`,
      });
    } else {
      diagnostics.warning({
        code: "PF1602",
        message,
        help: `${stood.effectId} is a different calibre in the same band, so check the separation`,
      });
    }
  }
  for (const line of short) {
    diagnostics.error({
      code: "PF1600",
      message: `nothing in stock can stand in for ${line.effectId}, ${plural(line.shots, "cue")} left as written`,
      help: "redesign the cue, or buy in",
    });
  }
  return diagnostics;
}

/** Lot numbers with the repeats counted, which is how a book reads. */
export function describeLots(lots: readonly string[]): string {
  const counts = new Map<string, number>();
  for (const lot of lots) {
    counts.set(lot, (counts.get(lot) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([lot, count]) => (count === 1 ? lot : `${lot} x${count}`))
    .join(", ");
}

/** One line per stand in, for a report that has already named the shortfall. */
export function describeStandIn(stood: StandIn): string {
  return `${plural(stood.shots, "cue")} as ${stood.effectId} from ${describeLots(stood.lots)}`;
}
