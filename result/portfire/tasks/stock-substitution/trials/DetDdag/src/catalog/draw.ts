import type { Effect } from "./effect.js";
import { Magazine } from "./inventory.js";
import type { Lot } from "./inventory.js";
import type { Catalog } from "./registry.js";
import { substitutesFor } from "./substitute.js";
import type { Substitute } from "./substitute.js";
import { DiagnosticBag } from "../core/diagnostic.js";
import { compareIds } from "../core/ids.js";
import type { Span } from "../core/span.js";
import { raw } from "../core/units.js";
import type { ResolvedShot } from "../script/resolve.js";

/**
 * Firing the show off the stock the crew actually holds.
 *
 * A show is designed against a catalog and fired out of a magazine, and the
 * catalog is a wish list. `substitutesFor` has always known which shell could
 * stand in for another; what was missing was anybody asking it. So the draw
 * walks the show in firing order and takes a shell out of the magazine per cue,
 * which is what happens on the field: the first cues get what the script asked
 * for and the ones at the back of the show get whatever is left in the store.
 *
 * The order is the whole design. Every cue gets a chance at its own effect
 * before any cue is offered a stand-in, because a show that spent the last ten
 * six inch palms covering an earlier shortfall and then had none for the cues
 * that were written for them would be worse than one that simply ran out at the
 * end. Within an effect the oldest lot goes first, which is how a store is
 * meant to be run.
 *
 * A shell lent to one cue is gone, so one shortfall can be covered by several
 * different stand-ins, and a cue nothing can cover keeps what was written. That
 * last case is an error rather than a silent change, because the alternative is
 * a firing table with a cue on it that has no shell behind it.
 */

export interface DrawOptions {
  /**
   * Lot numbers set aside before the draw. A recall, a damaged case or a lot
   * held back for a later show all come to the same thing: it is in the book
   * and it is not going up tonight.
   */
  readonly pull?: readonly string[];
}

/** One asked-for effect and one thing that stood in for it. */
export interface StandIn {
  /** What the script asked for. */
  readonly effectId: string;
  /** What went in the tube instead. */
  readonly substituteId: string;
  readonly substitute: Effect;
  /** Exact when the calibre matches, near when only the handling band does. */
  readonly quality: "exact" | "near";
  /** How many cues it covered. */
  readonly shots: number;
  /** The lots drawn from, in the order they were drawn. */
  readonly lots: readonly string[];
}

/** An effect the magazine could neither supply nor cover. */
export interface UncoveredLine {
  readonly effectId: string;
  /** How many cues were left holding what the script wrote. */
  readonly short: number;
}

export interface Draw {
  /** The show as it will be fired, in the order it was handed in. */
  readonly shots: readonly ResolvedShot[];
  readonly standIns: readonly StandIn[];
  readonly uncovered: readonly UncoveredLine[];
  /** The book after the draw, so the caller's copy is left alone. */
  readonly remaining: Magazine;
  readonly diagnostics: DiagnosticBag;
}

/**
 * The book without the lots named, leaving the original alone. Quarantine on a
 * `Magazine` empties the caller's copy, and a compile must not change the stock
 * record it was handed.
 */
export function withoutLots(
  magazine: Magazine,
  pull: readonly string[],
): Magazine {
  const copy = Magazine.from(
    magazine.stock().flatMap((line) => line.lots.map((lot) => ({ ...lot }))),
  );
  for (const lotNumber of pull) {
    copy.quarantine(normaliseLot(lotNumber));
  }
  return copy;
}

function normaliseLot(lotNumber: string): string {
  return lotNumber.trim().toLowerCase();
}

/**
 * Which lot leaves the store first: the oldest received, then anything with no
 * date on it, then by lot number so two rows from the same delivery draw in a
 * fixed order rather than in whatever order the book was typed.
 */
export function compareIssueOrder(a: Lot, b: Lot): number {
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

interface Held {
  readonly lotNumber: string;
  remaining: number;
}

/** The stock as it stands part way through a draw. */
class Shelf {
  private readonly held = new Map<string, Held[]>();

  constructor(magazine: Magazine) {
    for (const line of magazine.stock()) {
      this.held.set(
        line.effectId,
        [...line.lots].sort(compareIssueOrder).map((lot) => ({
          lotNumber: lot.lotNumber,
          remaining: lot.quantity,
        })),
      );
    }
  }

  /** Take one unit, oldest lot first, and say which lot it came out of. */
  take(effectId: string): string | undefined {
    for (const lot of this.held.get(effectId) ?? []) {
      if (lot.remaining > 0) {
        lot.remaining -= 1;
        return lot.lotNumber;
      }
    }
    return undefined;
  }

  /** What is left, as a book, for a caller that wants to keep drawing. */
  book(): Magazine {
    const magazine = new Magazine();
    for (const [effectId, lots] of this.held) {
      for (const lot of lots) {
        if (lot.remaining > 0) {
          magazine.receive({
            lotNumber: lot.lotNumber,
            effectId,
            quantity: lot.remaining,
          });
        }
      }
    }
    return magazine;
  }
}

interface Numbered {
  readonly index: number;
  readonly shot: ResolvedShot;
}

/**
 * Firing order, which is the visible time and then the order the script was
 * written in. Two cues on the same beat draw in the order somebody typed them,
 * because that is the only order they can be asked to explain.
 */
function firingOrder(shots: readonly ResolvedShot[]): Numbered[] {
  return shots
    .map((shot, index) => ({ index, shot }))
    .sort((a, b) => {
      const gap = raw(a.shot.at) - raw(b.shot.at);
      return gap !== 0 ? gap : a.index - b.index;
    });
}

interface Tally {
  effectId: string;
  substituteId: string;
  substitute: Effect;
  quality: "exact" | "near";
  shots: number;
  lots: string[];
}

export function drawShots(
  shots: readonly ResolvedShot[],
  catalog: Catalog,
  magazine: Magazine,
  options: DrawOptions = {},
): Draw {
  const shelf = new Shelf(withoutLots(magazine, options.pull ?? []));
  const order = firingOrder(shots);
  // The show as it will be fired, filled in in place so a cue that draws
  // nothing keeps exactly what the script wrote.
  const drawn: ResolvedShot[] = [...shots];
  const wanting: Numbered[] = [];

  // Every cue gets a chance at what it was written for before any cue is
  // offered a stand-in.
  for (const { index, shot } of order) {
    const lot = shelf.take(shot.resolved.id);
    if (lot === undefined) {
      wanting.push({ index, shot });
      continue;
    }
    drawn[index] = { ...shot, lot };
  }

  const offers = new Map<string, readonly Substitute[]>();
  const stood = new Map<string, Tally>();
  const missing = new Map<string, { short: number; origin: Span }>();

  for (const { index, shot } of wanting) {
    const asked = shot.effect;
    let candidates = offers.get(shot.resolved.id);
    if (candidates === undefined) {
      candidates = substitutesFor(shot.resolved, catalog);
      offers.set(shot.resolved.id, candidates);
    }
    let covered = false;
    for (const candidate of candidates) {
      const lot = shelf.take(candidate.effect.id);
      if (lot === undefined) {
        continue;
      }
      drawn[index] = {
        ...shot,
        resolved: candidate.effect,
        lot,
        substitutedFor: asked,
      };
      const key = `${asked}\u0000${candidate.effect.id}`;
      const tally = stood.get(key);
      if (tally === undefined) {
        stood.set(key, {
          effectId: asked,
          substituteId: candidate.effect.id,
          substitute: candidate.effect,
          quality: candidate.quality,
          shots: 1,
          lots: [lot],
        });
      } else {
        tally.shots += 1;
        if (!tally.lots.includes(lot)) {
          tally.lots.push(lot);
        }
      }
      covered = true;
      break;
    }
    if (!covered) {
      // Nothing covers it. The cue keeps what was written, which is already
      // what is in the list, and somebody has to deal with it before the show
      // is fired.
      const line = missing.get(asked);
      if (line === undefined) {
        missing.set(asked, { short: 1, origin: shot.origin });
      } else {
        line.short += 1;
      }
    }
  }

  const standIns: StandIn[] = [...stood.values()]
    .map((tally) => ({
      effectId: tally.effectId,
      substituteId: tally.substituteId,
      substitute: tally.substitute,
      quality: tally.quality,
      shots: tally.shots,
      lots: tally.lots,
    }))
    .sort(
      (a, b) =>
        compareIds(a.effectId, b.effectId) ||
        compareIds(a.substituteId, b.substituteId),
    );
  const unfilled: Unfilled[] = [...missing.entries()]
    .map(([effectId, line]) => ({
      effectId,
      short: line.short,
      origin: line.origin,
    }))
    .sort((a, b) => compareIds(a.effectId, b.effectId));
  const uncovered: UncoveredLine[] = unfilled.map((line) => ({
    effectId: line.effectId,
    short: line.short,
  }));

  return {
    shots: drawn,
    standIns,
    uncovered,
    remaining: shelf.book(),
    diagnostics: checkDraw(standIns, unfilled),
  };
}

interface Unfilled extends UncoveredLine {
  /** Where the first cue nothing covers was written, for the error. */
  readonly origin: Span;
}

function checkDraw(
  standIns: readonly StandIn[],
  unfilled: readonly Unfilled[],
): DiagnosticBag {
  const diagnostics = new DiagnosticBag();
  for (const line of unfilled) {
    diagnostics.error({
      code: "PF1600",
      message: `nothing in stock can stand in for ${line.effectId}, ${line.short} ${
        line.short === 1 ? "cue is" : "cues are"
      } short`,
      help: "redesign the cue, or buy in",
      span: line.origin,
    });
  }
  for (const stood of standIns) {
    const message = `${stood.effectId} short ${stood.shots}, drew ${stood.substituteId} from ${
      stood.lots.length === 1 ? "lot" : "lots"
    } ${stood.lots.join(", ")}`;
    if (stood.quality === "exact") {
      diagnostics.note({ code: "PF1601", message });
    } else {
      diagnostics.warning({
        code: "PF1602",
        message,
        help: `${stood.substituteId} is a different calibre in the same band, so check the separation`,
      });
    }
  }
  return diagnostics;
}

/** A line per stand-in, for a report or the end of a CLI run. */
export function describeDraw(draw: Draw): string {
  if (draw.standIns.length === 0 && draw.uncovered.length === 0) {
    return "every cue drew what the script asked for";
  }
  const lines = draw.standIns.map(
    (stood) =>
      `${stood.effectId} short ${stood.shots}, drew ${stood.substituteId} from ${stood.lots.join(", ")}`,
  );
  for (const line of draw.uncovered) {
    lines.push(`${line.effectId} short ${line.short}, nothing stands in`);
  }
  return lines.join("\n");
}
