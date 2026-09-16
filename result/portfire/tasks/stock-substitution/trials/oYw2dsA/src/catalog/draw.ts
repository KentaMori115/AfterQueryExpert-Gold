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
 * magazine happens to hold, and the gap between those two is closed on the
 * afternoon of the load by a shooter with a clipboard. This is that job done
 * on paper first: walk the show in firing order, take each shot's own shell
 * while there is one, and only then go back over what was left short and see
 * what else in the store will do.
 *
 * The order is the whole point. Every cue gets its first refusal on its own
 * effect before anything is lent to a substitute, because a stand-in in bar
 * two that eats the last six inch palm turns a designed show into a different
 * one by the finale. Within an effect the oldest lot goes first, which is what
 * a magazine does anyway: stock rotates, and the case that has been on the
 * shelf longest is the one that leaves.
 *
 * Nothing here spends the book it was handed. The book is a legal record of
 * what the crew holds and a compile is a rehearsal on paper, so the draw runs
 * against a copy and the caller's magazine comes back untouched.
 */

/** One asked for effect covered by one stand in, with what it cost. */
export interface StandInLine {
  /** What the script asked for. */
  readonly askedFor: string;
  /** What fires instead. */
  readonly effectId: string;
  /** Exact when the calibre matches, near when only the handling band does. */
  readonly quality: "exact" | "near";
  /** How many shots of the asked for effect this stand in covers. */
  readonly shots: number;
  /** The lots drawn, in the order they were drawn. */
  readonly lots: readonly string[];
}

/** An asked for effect that ran out and that nothing in stock can cover. */
export interface UncoveredLine {
  readonly effectId: string;
  readonly shots: number;
}

export interface DrawResult {
  /**
   * The show as it will actually be fired. A shot that drew its own effect is
   * unchanged apart from the lot; a shot standing in carries the stand in as
   * its effect, so everything downstream, the lift compensation, the pins and
   * the separation distances, sees the shell that is going in the mortar.
   */
  readonly shots: readonly ResolvedShot[];
  readonly standIns: readonly StandInLine[];
  readonly uncovered: readonly UncoveredLine[];
  readonly diagnostics: DiagnosticBag;
}

/**
 * The order a magazine issues from: oldest received first, undated last
 * because a row without a date is nearly always an older one, and lot number
 * to settle a tie so two crews reading the same book draw the same case.
 */
export function compareLots(a: Lot, b: Lot): number {
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

export function issueOrder(lots: readonly Lot[]): Lot[] {
  return [...lots].sort(compareLots);
}

interface Held {
  readonly lotNumber: string;
  left: number;
}

/**
 * What is left on the shelf as the draw proceeds. Counting here rather than
 * against the magazine is what lets one shortfall span several stand ins: a
 * shell lent to an early cue is gone, so the next cue short of the same thing
 * has to be told the truth about what remains.
 */
class Shelf {
  private readonly queues = new Map<string, Held[]>();

  constructor(private readonly magazine: Magazine) {}

  private queue(effectId: string): Held[] {
    const known = this.queues.get(effectId);
    if (known !== undefined) {
      return known;
    }
    const fresh = issueOrder(this.magazine.lotsFor(effectId)).map((lot) => ({
      lotNumber: lot.lotNumber,
      left: lot.quantity,
    }));
    this.queues.set(effectId, fresh);
    return fresh;
  }

  /** Take one, oldest lot first, or nothing when the shelf is bare. */
  take(effectId: string): string | undefined {
    for (const held of this.queue(effectId)) {
      if (held.left > 0) {
        held.left -= 1;
        return held.lotNumber;
      }
    }
    return undefined;
  }
}

interface Entry {
  readonly shot: ResolvedShot;
  readonly index: number;
}

/**
 * Firing order, which is the time the audience sees the effect and then the
 * order the cues were written. Sorting on the visible time rather than the
 * ignition time matters: two cues on the same beat draw in the order they
 * appear in the script whatever their lift times are, so editing a script
 * cannot silently move which cue gets the last case.
 */
function firingOrder(shots: readonly ResolvedShot[]): Entry[] {
  return shots
    .map((shot, index) => ({ shot, index }))
    .sort((a, b) => {
      const gap = raw(a.shot.at) - raw(b.shot.at);
      return gap !== 0 ? gap : a.index - b.index;
    });
}

interface Cover {
  readonly substitute: Substitute;
  readonly lotNumber: string;
}

/** One asked for effect and one stand in, counted up as the draw runs. */
interface Tally {
  readonly askedFor: string;
  readonly effectId: string;
  readonly quality: "exact" | "near";
  shots: number;
  readonly lots: string[];
}

function standInKey(askedFor: string, effectId: string): string {
  return `${askedFor}\u0000${effectId}`;
}

export function drawShow(
  shots: readonly ResolvedShot[],
  catalog: Catalog,
  magazine: Magazine,
): DrawResult {
  const shelf = new Shelf(magazine);
  const ordered = firingOrder(shots);
  const own = new Map<number, string>();
  const short: Entry[] = [];

  // Every cue takes its own effect first, in firing order. Later cues go
  // without rather than earlier ones going short.
  for (const entry of ordered) {
    const lotNumber = shelf.take(entry.shot.effect);
    if (lotNumber === undefined) {
      short.push(entry);
    } else {
      own.set(entry.index, lotNumber);
    }
  }

  const offers = new Map<string, Substitute[]>();
  const covers = new Map<number, Cover>();
  const lines = new Map<string, Tally>();
  const uncovered = new Map<string, number>();

  for (const entry of short) {
    const askedFor = entry.shot.effect;
    let candidates = offers.get(askedFor);
    if (candidates === undefined) {
      candidates = substitutesFor(entry.shot.resolved, catalog);
      offers.set(askedFor, candidates);
    }
    let cover: Cover | undefined;
    for (const candidate of candidates) {
      const lotNumber = shelf.take(candidate.effect.id);
      if (lotNumber !== undefined) {
        cover = { substitute: candidate, lotNumber };
        break;
      }
    }
    if (cover === undefined) {
      uncovered.set(askedFor, (uncovered.get(askedFor) ?? 0) + 1);
      continue;
    }
    covers.set(entry.index, cover);
    const key = standInKey(askedFor, cover.substitute.effect.id);
    const already = lines.get(key);
    if (already === undefined) {
      lines.set(key, {
        askedFor,
        effectId: cover.substitute.effect.id,
        quality: cover.substitute.quality,
        shots: 1,
        lots: [cover.lotNumber],
      });
    } else {
      already.shots += 1;
      already.lots.push(cover.lotNumber);
    }
  }

  const drawn = shots.map((shot, index) => {
    const lot = own.get(index);
    if (lot !== undefined) {
      return { ...shot, lot };
    }
    const cover = covers.get(index);
    if (cover === undefined) {
      // Nothing covers it. The shot keeps what was written, so the sheet still
      // says what the show was meant to be, and the error says it cannot fire.
      return shot;
    }
    return {
      ...shot,
      effect: cover.substitute.effect.id,
      resolved: cover.substitute.effect,
      substitutedFor: shot.effect,
      lot: cover.lotNumber,
    };
  });

  const standIns: StandInLine[] = [...lines.values()]
    .map((tally) => ({ ...tally, lots: [...new Set(tally.lots)] }))
    .sort(
      (a, b) =>
        compareIds(a.askedFor, b.askedFor) ||
        compareIds(a.effectId, b.effectId),
    );
  const missing = [...uncovered.entries()]
    .map(([effectId, count]) => ({ effectId, shots: count }))
    .sort((a, b) => compareIds(a.effectId, b.effectId));

  return {
    shots: drawn,
    standIns,
    uncovered: missing,
    diagnostics: checkDraw(standIns, missing),
  };
}

/**
 * What the draw has to say for itself. One line per pair rather than per shot,
 * because a finale that swaps forty shells is one decision a shooter makes
 * once and forty diagnostics nobody reads.
 */
export function checkDraw(
  standIns: readonly StandInLine[],
  uncovered: readonly UncoveredLine[],
): DiagnosticBag {
  const diagnostics = new DiagnosticBag();
  for (const line of standIns) {
    const message = `${plural(line.shots, "shot")} of ${line.askedFor} ${line.shots === 1 ? "fires" : "fire"} ${line.effectId} instead`;
    const from = `drawn from ${line.lots.length === 1 ? "lot" : "lots"} ${line.lots.join(", ")}`;
    if (line.quality === "exact") {
      diagnostics.note({ code: "PF1601", message, help: from });
    } else {
      diagnostics.warning({
        code: "PF1602",
        message,
        help: `${line.effectId} is a different calibre in the same band, so check the separation, ${from}`,
      });
    }
  }
  for (const line of uncovered) {
    diagnostics.error({
      code: "PF1600",
      message: `nothing in stock can stand in for ${line.effectId}, ${plural(line.shots, "shot")} left short`,
      help: "redesign the cue, or buy in",
    });
  }
  return diagnostics;
}

/** The stand ins drawn against one asked for effect, for a report. */
export function standInsFor(draw: DrawResult, effectId: string): StandInLine[] {
  return draw.standIns.filter((line) => line.askedFor === effectId);
}

/** Every lot the show draws on, with how many shots come off each. */
export function lotsDrawn(draw: DrawResult): Map<string, number> {
  const counts = new Map<string, number>();
  for (const shot of draw.shots) {
    if (shot.lot === undefined) {
      continue;
    }
    counts.set(shot.lot, (counts.get(shot.lot) ?? 0) + 1);
  }
  return counts;
}

/** A one line verdict, for the top of a report. */
export function describeDraw(draw: DrawResult): string {
  const swapped = draw.standIns.reduce((total, line) => total + line.shots, 0);
  const missing = draw.uncovered.reduce((total, line) => total + line.shots, 0);
  const parts: string[] = [];
  if (swapped > 0) {
    parts.push(
      `${plural(swapped, "shot")} ${swapped === 1 ? "fires" : "fire"} a stand in`,
    );
  }
  if (missing > 0) {
    parts.push(
      `${plural(missing, "shot")} ${missing === 1 ? "has" : "have"} nothing to fire`,
    );
  }
  return parts.length === 0
    ? "every cue draws what the script asked for"
    : parts.join(", ");
}
