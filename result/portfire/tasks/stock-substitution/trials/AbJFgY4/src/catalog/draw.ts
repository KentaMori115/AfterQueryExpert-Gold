import type { Magazine } from "./inventory.js";
import type { Catalog } from "./registry.js";
import { substitutesFor } from "./substitute.js";
import type { Substitute } from "./substitute.js";
import { DiagnosticBag } from "../core/diagnostic.js";
import { compareIds } from "../core/ids.js";
import { listPhrase, plural } from "../core/text.js";
import { raw } from "../core/units.js";
import type { ResolvedShot } from "../script/resolve.js";

/**
 * Drawing a written show out of the stock a crew actually holds.
 *
 * A show is designed against the house catalog and fired out of the magazine,
 * and the two disagree by the afternoon of the show. Up to here the compiler
 * has taken the script at its word. This is where every shot is handed a real
 * shell from a real lot, and where a cue that cannot be supplied has to be
 * either covered by something else or reported.
 *
 * Two passes, and the order of them is the whole point. Every cue draws what
 * the script asked for first, in firing order, so the shots that go up on the
 * shells they were written for are the early ones and the shortfall lands at
 * the end of the show where a designer can see it. Only when nothing is left
 * to draw honestly does the second pass go looking for stand ins. Doing it in
 * one pass would let cue three take a substitute while the stock it wanted sat
 * in the magazine waiting for cue four hundred.
 *
 * A shell lent out is gone, so a shortfall of six may be covered by four of
 * one shell and two of another, and each of those is its own line on the
 * paperwork.
 */

export interface StandInLine {
  /** What the script asked for. */
  readonly askedFor: string;
  readonly standIn: string;
  /** Exact when the calibre matches, near when only the handling band does. */
  readonly quality: "exact" | "near";
  readonly shots: number;
  /** The lots drawn, one entry per shot, in the order they were drawn. */
  readonly lots: readonly string[];
}

export interface UncoveredLine {
  readonly effectId: string;
  readonly shots: number;
}

export interface DrawResult {
  /**
   * The shots as they will be fired, in the order they were handed in. A shot
   * that drew what it asked for carries its lot, a covered shot carries the
   * stand in as its effect and the ask as `substitutedFor`, and a shot nothing
   * covers is untouched.
   */
  readonly shots: readonly ResolvedShot[];
  readonly standIns: readonly StandInLine[];
  readonly uncovered: readonly UncoveredLine[];
  /** What is left in the book after the show has been drawn out of it. */
  readonly magazine: Magazine;
  readonly diagnostics: DiagnosticBag;
}

export interface DrawOptions {
  /**
   * Lot numbers to set aside before anything is drawn, which is what a recall
   * or a damaged case means. A pulled lot is not available to a stand in
   * either.
   */
  readonly pull?: readonly string[];
}

interface Cue {
  readonly shot: ResolvedShot;
  /** Where the shot sits in the list handed in, which is the order written. */
  readonly index: number;
}

/**
 * Firing order: the time the audience sees it, then the order it was written.
 * A sort that keeps equal entries where they were gives the second half of that
 * for nothing, which is what a run of cues on one beat needs.
 */
function firingOrder(shots: readonly ResolvedShot[]): Cue[] {
  return shots
    .map((shot, index) => ({ shot, index }))
    .sort((a, b) => raw(a.shot.at) - raw(b.shot.at));
}

interface Cover {
  readonly substitute: Substitute;
  readonly lot: string;
}

/** One asked for and stand in pair, gathering lots as the draw goes on. */
interface Covered {
  readonly askedFor: string;
  readonly standIn: string;
  readonly quality: "exact" | "near";
  readonly lots: string[];
}

/**
 * The first candidate the magazine can still supply, one unit at a time.
 *
 * The candidates are what `substitutesFor` offers by default, in its own
 * order: same calibre before a band match, nearest flight time next, then the
 * name. Availability is asked of the magazine as it stands rather than as it
 * arrived, because the shell this shot draws is one the next shot cannot.
 */
function cover(
  candidates: readonly Substitute[],
  magazine: Magazine,
): Cover | undefined {
  for (const substitute of candidates) {
    const lot = magazine.issue(substitute.effect.id, 1)[0];
    if (lot !== undefined) {
      return { substitute, lot };
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
  const book = magazine.copy();
  for (const lotNumber of options.pull ?? []) {
    if (book.quarantine(lotNumber) === 0) {
      diagnostics.warning({
        code: "PF1603",
        message: `lot ${lotNumber} was set aside but the magazine does not hold it`,
        help: "check the lot number, a pull that matches nothing protects nothing",
      });
    }
  }

  const drawn: ResolvedShot[] = [...shots];
  const short: Cue[] = [];

  for (const cue of firingOrder(shots)) {
    const { shot, index } = cue;
    const lot = book.issue(shot.effect, 1)[0];
    if (lot === undefined) {
      short.push(cue);
      continue;
    }
    drawn[index] = { ...shot, lot };
  }

  const candidates = new Map<string, readonly Substitute[]>();
  const covered = new Map<string, Covered>();
  const missing = new Map<string, number>();

  for (const { shot, index } of short) {
    let offered = candidates.get(shot.effect);
    if (offered === undefined) {
      offered = substitutesFor(shot.resolved, catalog);
      candidates.set(shot.effect, offered);
    }
    const found = cover(offered, book);
    if (found === undefined) {
      missing.set(shot.effect, (missing.get(shot.effect) ?? 0) + 1);
      continue;
    }
    const standIn = found.substitute.effect;
    drawn[index] = {
      ...shot,
      effect: standIn.id,
      resolved: standIn,
      substitutedFor: shot.effect,
      lot: found.lot,
    };
    // One line per pair, however many shots it ends up covering, because that
    // is the unit the paperwork and the conversation both work in.
    const key = `${shot.effect} ${standIn.id}`;
    const held = covered.get(key);
    if (held === undefined) {
      covered.set(key, {
        askedFor: shot.effect,
        standIn: standIn.id,
        quality: found.substitute.quality,
        lots: [found.lot],
      });
    } else {
      held.lots.push(found.lot);
    }
  }

  const standIns: StandInLine[] = [...covered.values()]
    .map((held) => ({
      askedFor: held.askedFor,
      standIn: held.standIn,
      quality: held.quality,
      shots: held.lots.length,
      lots: held.lots,
    }))
    .sort(
      (a, b) =>
        compareIds(a.askedFor, b.askedFor) || compareIds(a.standIn, b.standIn),
    );
  const uncovered: UncoveredLine[] = [...missing.entries()]
    .map(([effectId, count]) => ({ effectId, shots: count }))
    .sort((a, b) => compareIds(a.effectId, b.effectId));

  diagnostics.addAll(checkDraw(standIns, uncovered).all());
  return { shots: drawn, standIns, uncovered, magazine: book, diagnostics };
}

/**
 * What the draw is worth saying out loud.
 *
 * A stand in of the same calibre is a note, because nothing downstream
 * changes: the timing table and the separation distance are the ones already
 * on the paperwork. A band match is a warning, because the calibre moved and
 * the separation has to be looked at again. A shot nothing covers is an error,
 * because the cue is still written for a shell the crew does not have.
 */
export function checkDraw(
  standIns: readonly StandInLine[],
  uncovered: readonly UncoveredLine[],
): DiagnosticBag {
  const diagnostics = new DiagnosticBag();
  for (const line of standIns) {
    const message = `${line.askedFor} short ${plural(line.shots, "shot")}, firing ${line.standIn} instead`;
    const lots = listPhrase([...new Set(line.lots)]);
    if (line.quality === "exact") {
      diagnostics.note({
        code: "PF1601",
        message,
        help: `the same calibre, so the timing and the separation stand, drawn from lot ${lots}`,
      });
      continue;
    }
    diagnostics.warning({
      code: "PF1602",
      message,
      help: `${line.standIn} is a different calibre in the same band, so check the separation, drawn from lot ${lots}`,
    });
  }
  for (const line of uncovered) {
    diagnostics.error({
      code: "PF1600",
      message: `nothing in stock can stand in for ${plural(line.shots, "shot")} of ${line.effectId}`,
      help: "the cue keeps what was written, so redesign it or buy the shells in",
    });
  }
  return diagnostics;
}

/** One line per stand in, for a report or the end of a command. */
export function describeDraw(result: DrawResult): string {
  if (result.standIns.length === 0 && result.uncovered.length === 0) {
    return "every cue drew the effect it was written for";
  }
  const lines = result.standIns.map(
    (line) =>
      `${line.askedFor}: ${plural(line.shots, "shot")} as ${line.standIn}, lot ${listPhrase([...new Set(line.lots)])}`,
  );
  for (const line of result.uncovered) {
    lines.push(
      `${line.effectId}: ${plural(line.shots, "shot")} with nothing to stand in`,
    );
  }
  return lines.join("\n");
}
