import type { Magazine } from "./inventory.js";
import type { Catalog } from "./registry.js";
import { substitutesFor } from "./substitute.js";
import type { SubstituteOptions } from "./substitute.js";
import { DiagnosticBag } from "../core/diagnostic.js";
import { compareIds } from "../core/ids.js";
import type { Span } from "../core/span.js";
import { plural } from "../core/text.js";
import { raw } from "../core/units.js";
import type { ResolvedShot } from "../script/resolve.js";

/**
 * Drawing the show out of the magazine.
 *
 * A show is designed against the house catalog and fired out of whatever the
 * magazine book actually holds, and the gap between those two is settled on the
 * field rather than at the desk. Up to here the compiler has been working with
 * the catalog, which is a list of what the crew can buy. This stage walks the
 * show against the book, hands each cue a real lot number, and where the shelf
 * is empty puts something else in the tube.
 *
 * Two passes, and the order is the whole design. The first pass gives every cue
 * the effect it asked for while stock lasts, so a shell is never lent to a
 * substitution while a later cue still wants it for itself. Only when every cue
 * has had its own draw does the second pass go back for the ones left short.
 * Doing it in one pass would let cue four hundred take the last six inch palm
 * as a stand in for something else, and cue four hundred and one, which was
 * written for that palm, would then be the one left with nothing.
 *
 * Within a pass the order is firing order, earliest visible time first and
 * script order inside a tie. That is not arbitrary either. When stock runs out
 * partway through a show it is the later cues that go without, which is the
 * answer a shooter expects and can plan around.
 *
 * A drawn unit is gone. So a shortfall of six can be covered by four of one
 * stand in and two of another, and each cue records the lot it actually got.
 */

export interface DrawOptions {
  /**
   * Lot numbers set aside before anything is drawn, which is what a recall or a
   * damaged case means. They are gone for this show whatever the book says.
   */
  readonly pull?: readonly string[];
  /** How a stand in is chosen. The defaults are what `substitutesFor` offers. */
  readonly substitutes?: SubstituteOptions;
}

/** One asked for effect and one stand in, with how many cues it covered. */
export interface Substitution {
  /** What the script asked for. */
  readonly asked: string;
  /** What is going in the tube. */
  readonly standIn: string;
  /** Exact when the calibre matches, near when only the handling band does. */
  readonly quality: "exact" | "near";
  readonly count: number;
  /** The lots drawn, in the order they were drawn. */
  readonly lots: readonly string[];
}

/** An effect the magazine could neither supply nor cover. */
export interface Uncovered {
  readonly effectId: string;
  readonly count: number;
  /** The first cue left short, so a report can point at the script. */
  readonly origin?: Span;
}

export interface Draw {
  /** The show as it will be fired, each shot carrying its lot. */
  readonly shots: readonly ResolvedShot[];
  /** What is left in the book afterwards. The book passed in is untouched. */
  readonly remaining: Magazine;
  readonly substitutions: readonly Substitution[];
  readonly uncovered: readonly Uncovered[];
  readonly diagnostics: DiagnosticBag;
}

/**
 * A copy of the book with some lots taken out of it. Used for the lots set
 * aside before a draw, and useful on its own for asking what a show would look
 * like if a lot were recalled tomorrow.
 */
export function withoutLots(
  magazine: Magazine,
  lotNumbers: Iterable<string>,
): Magazine {
  const held = magazine.clone();
  for (const lotNumber of lotNumbers) {
    held.quarantine(lotNumber.trim().toLowerCase());
  }
  return held;
}

interface Ordered {
  readonly shot: ResolvedShot;
  readonly index: number;
}

/** Firing order: when the audience sees it, then the order it was written in. */
function firingOrder(shots: readonly ResolvedShot[]): Ordered[] {
  return shots
    .map((shot, index) => ({ shot, index }))
    .sort((a, b) => {
      const gap = raw(a.shot.at) - raw(b.shot.at);
      return gap !== 0 ? gap : a.index - b.index;
    });
}

interface Drawn {
  readonly lot: string;
  readonly standIn?: ResolvedShot["resolved"];
  readonly substitutedFor?: string;
}

export function drawShow(
  shots: readonly ResolvedShot[],
  catalog: Catalog,
  magazine: Magazine,
  options: DrawOptions = {},
): Draw {
  const held = withoutLots(magazine, options.pull ?? []);
  const order = firingOrder(shots);
  const drawn = new Map<number, Drawn>();
  const short: Ordered[] = [];

  for (const entry of order) {
    const lot = held.draw(entry.shot.resolved.id);
    if (lot === undefined) {
      short.push(entry);
      continue;
    }
    drawn.set(entry.index, { lot });
  }

  const candidates = new Map<string, ReturnType<typeof substitutesFor>>();
  const substitutions = new Map<string, Substitution>();
  const uncovered = new Map<string, Uncovered>();

  for (const entry of short) {
    const wanted = entry.shot.resolved;
    let offered = candidates.get(wanted.id);
    if (offered === undefined) {
      offered = substitutesFor(wanted, catalog, options.substitutes ?? {});
      candidates.set(wanted.id, offered);
    }
    let covered = false;
    for (const candidate of offered) {
      const lot = held.draw(candidate.effect.id);
      if (lot === undefined) {
        continue;
      }
      drawn.set(entry.index, {
        lot,
        standIn: candidate.effect,
        substitutedFor: wanted.id,
      });
      const key = `${wanted.id} ${candidate.effect.id}`;
      const already = substitutions.get(key);
      substitutions.set(key, {
        asked: wanted.id,
        standIn: candidate.effect.id,
        quality: candidate.quality,
        count: (already?.count ?? 0) + 1,
        lots: [...(already?.lots ?? []), lot],
      });
      covered = true;
      break;
    }
    if (covered) {
      continue;
    }
    const already = uncovered.get(wanted.id);
    uncovered.set(wanted.id, {
      effectId: wanted.id,
      count: (already?.count ?? 0) + 1,
      ...(already?.origin === undefined
        ? { origin: entry.shot.origin }
        : { origin: already.origin }),
    });
  }

  const lines = [...substitutions.values()].sort(
    (a, b) => compareIds(a.asked, b.asked) || compareIds(a.standIn, b.standIn),
  );
  const missing = [...uncovered.values()].sort((a, b) =>
    compareIds(a.effectId, b.effectId),
  );

  return {
    shots: shots.map((shot, index) => {
      const take = drawn.get(index);
      if (take === undefined) {
        // Nothing covered it, so the cue keeps what the script wrote. The crew
        // has to see the show it asked for next to the error saying it cannot
        // be fired, rather than a hole where the cue was.
        return shot;
      }
      return {
        ...shot,
        ...(take.standIn === undefined ? {} : { resolved: take.standIn }),
        ...(take.substitutedFor === undefined
          ? {}
          : { substitutedFor: take.substitutedFor }),
        lot: take.lot,
      };
    }),
    remaining: held,
    substitutions: lines,
    uncovered: missing,
    diagnostics: checkDraw(lines, missing),
  };
}

/**
 * What the draw has to say for itself.
 *
 * One line per pair rather than one per cue. A finale that swaps thirty shells
 * for thirty others is one decision a shooter either accepts or does not, and
 * thirty identical notes would bury the one line that matters underneath it.
 */
export function checkDraw(
  substitutions: readonly Substitution[],
  uncovered: readonly Uncovered[],
): DiagnosticBag {
  const diagnostics = new DiagnosticBag();
  for (const line of substitutions) {
    const message = `${line.asked} short ${line.count}, drew ${line.standIn} instead`;
    if (line.quality === "exact") {
      diagnostics.note({ code: "PF1601", message });
    } else {
      diagnostics.warning({
        code: "PF1602",
        message,
        help: `${line.standIn} is a different calibre in the same band, so check the separation`,
      });
    }
  }
  for (const line of uncovered) {
    diagnostics.error({
      code: "PF1600",
      message: `nothing in the magazine can stand in for ${line.effectId}, ${plural(line.count, "cue")} left short`,
      ...(line.origin === undefined ? {} : { span: line.origin }),
      help: "redesign the cue, buy in, or set another lot aside",
    });
  }
  return diagnostics;
}

/** A one line verdict, for the top of a report. */
export function summariseDraw(draw: Draw): string {
  if (draw.substitutions.length === 0 && draw.uncovered.length === 0) {
    return "every cue drew the effect it was written for";
  }
  const swapped = draw.substitutions.reduce(
    (total, line) => total + line.count,
    0,
  );
  const missed = draw.uncovered.reduce((total, line) => total + line.count, 0);
  const parts: string[] = [];
  if (swapped > 0) {
    parts.push(`${plural(swapped, "cue")} drew a stand in`);
  }
  if (missed > 0) {
    parts.push(`${plural(missed, "cue")} left short`);
  }
  return parts.join(", ");
}
