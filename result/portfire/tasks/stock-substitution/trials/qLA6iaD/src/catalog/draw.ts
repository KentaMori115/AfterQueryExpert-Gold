import type { Effect } from "./effect.js";
import type { Lot, Magazine } from "./inventory.js";
import type { Catalog } from "./registry.js";
import { substitutesFor } from "./substitute.js";
import type { Substitute, SubstituteOptions } from "./substitute.js";
import { DiagnosticBag } from "../core/diagnostic.js";
import { compareIds } from "../core/ids.js";
import type { Span } from "../core/span.js";
import { plural } from "../core/text.js";
import { raw } from "../core/units.js";
import type { ResolvedShot } from "../script/resolve.js";

/**
 * Drawing a show out of the magazine.
 *
 * A show is designed against the house catalog and fired out of whatever the
 * magazine book says is on the shelf, and the two are never the same thing. Up
 * to here the compiler has been working with the design. This is where it has
 * to work with the stock, shot by shot, and the order it does that in is the
 * order the crew would: firing order, one shell at a time, until the shelf is
 * empty.
 *
 * Two passes, and the second one matters. If every shortfall were covered as
 * it was met, an early cue could be handed a stand in while a later cue took
 * the last of the shell that stand in was meant to replace. So every cue draws
 * what it was written for first, and only when the whole show has had its turn
 * does anything go looking for something else. That way a shortfall lands on
 * the cues at the end of the show, which is where a shooter expects it and
 * where it is cheapest to redesign.
 *
 * A stand in is spent stock like any other, so one shortfall of five shells
 * can come back as three of one thing and two of another, and each of those
 * shots carries the lot it was actually drawn from. Nothing is invented: a
 * shot that nothing on the shelf can cover keeps the effect the script asked
 * for and the show is not fit to fire.
 */

export interface DrawOptions {
  /**
   * Lot numbers set aside before anything is drawn, which is what a recall or
   * a damaged case means. They are gone for the whole draw rather than skipped
   * per cue, because a quarantined lot does not come back.
   */
  readonly pull?: readonly string[];
  /** Passed through when a caller wants a wider or narrower search. */
  readonly substitutes?: SubstituteOptions;
}

/** One asked for effect covered by one stand in, and how many times. */
export interface Substitution {
  /** What the script asked for. */
  readonly effectId: string;
  readonly standIn: Effect;
  /** Exact when the calibre matches, near when only the handling band does. */
  readonly quality: "exact" | "near";
  readonly count: number;
  /** The lots the stand ins came out of, in the order they were drawn. */
  readonly lots: readonly string[];
}

/** An effect the magazine could neither supply nor cover. */
export interface Uncovered {
  readonly effectId: string;
  readonly short: number;
  /** Where the first cue that went short is written. */
  readonly origin?: Span;
}

export interface DrawResult {
  /**
   * Every shot, in the order it came in, with the lot it drew and the stand in
   * it was given. A shot nothing could cover is unchanged.
   */
  readonly shots: readonly ResolvedShot[];
  readonly diagnostics: DiagnosticBag;
  readonly substitutions: readonly Substitution[];
  readonly uncovered: readonly Uncovered[];
  /** What is left on the shelf once the show has been drawn. */
  readonly remaining: Magazine;
  /** Lots set aside before the draw, with what each one took out of stock. */
  readonly pulled: ReadonlyMap<string, number>;
}

interface Pending {
  readonly shot: ResolvedShot;
  readonly index: number;
}

/**
 * Firing order, which is what the audience sees and therefore what a shortfall
 * should follow. Two cues on the same instant keep the order they were written
 * in, so the same book and the same script always draw the same way.
 */
function firingOrder(shots: readonly ResolvedShot[]): Pending[] {
  return shots
    .map((shot, index) => ({ shot, index }))
    .sort((a, b) => raw(a.shot.at) - raw(b.shot.at) || a.index - b.index);
}

export function drawShow(
  shots: readonly ResolvedShot[],
  catalog: Catalog,
  magazine: Magazine,
  options: DrawOptions = {},
): DrawResult {
  const diagnostics = new DiagnosticBag();
  const remaining = magazine.clone();

  const pulled = new Map<string, number>();
  for (const lotNumber of options.pull ?? []) {
    const wanted = lotNumber.trim().toLowerCase();
    if (wanted.length === 0) {
      continue;
    }
    pulled.set(
      wanted,
      (pulled.get(wanted) ?? 0) + remaining.quarantine(wanted),
    );
  }
  for (const [lotNumber, units] of pulled) {
    diagnostics.note({
      code: "PF1603",
      message:
        units === 0
          ? `lot ${lotNumber} is set aside but the book does not hold it`
          : `lot ${lotNumber} is set aside, ${plural(units, "unit")} out of the draw`,
      ...(units === 0
        ? { help: "check the lot number against the magazine book" }
        : {}),
    });
  }

  const drawn: ResolvedShot[] = [...shots];
  const short: Pending[] = [];

  // First pass: everything takes what it was written for, while it lasts.
  for (const pending of firingOrder(shots)) {
    const lot = remaining.draw(pending.shot.resolved.id);
    if (lot === undefined) {
      short.push(pending);
      continue;
    }
    drawn[pending.index] = { ...pending.shot, lot: lot.lotNumber };
  }

  // Second pass: what is left short goes looking, in the same order.
  const candidates = new Map<string, readonly Substitute[]>();
  const covered = new Map<string, { substitution: Substitution }>();
  const missing = new Map<string, Uncovered>();

  for (const pending of short) {
    const wanted = pending.shot.resolved;
    let offered = candidates.get(wanted.id);
    if (offered === undefined) {
      offered = substitutesFor(wanted, catalog, options.substitutes ?? {});
      candidates.set(wanted.id, offered);
    }
    let taken:
      | { readonly substitute: Substitute; readonly lot: Lot }
      | undefined;
    for (const substitute of offered) {
      const lot = remaining.draw(substitute.effect.id);
      if (lot !== undefined) {
        taken = { substitute, lot };
        break;
      }
    }
    if (taken === undefined) {
      const already = missing.get(pending.shot.effect);
      missing.set(pending.shot.effect, {
        effectId: pending.shot.effect,
        short: (already?.short ?? 0) + 1,
        ...(already?.origin === undefined
          ? { origin: pending.shot.origin }
          : { origin: already.origin }),
      });
      continue;
    }
    drawn[pending.index] = {
      ...pending.shot,
      effect: taken.substitute.effect.id,
      resolved: taken.substitute.effect,
      substitutedFor: pending.shot.effect,
      lot: taken.lot.lotNumber,
    };
    const key = `${pending.shot.effect}\u0000${taken.substitute.effect.id}`;
    const held = covered.get(key)?.substitution;
    covered.set(key, {
      substitution: {
        effectId: pending.shot.effect,
        standIn: taken.substitute.effect,
        quality: taken.substitute.quality,
        count: (held?.count ?? 0) + 1,
        lots: [...(held?.lots ?? []), taken.lot.lotNumber],
      },
    });
  }

  const substitutions = [...covered.values()]
    .map((entry) => entry.substitution)
    .sort(
      (a, b) =>
        compareIds(a.effectId, b.effectId) ||
        compareIds(a.standIn.id, b.standIn.id),
    );
  const uncovered = [...missing.values()].sort((a, b) =>
    compareIds(a.effectId, b.effectId),
  );

  diagnostics.addAll(checkDraw(substitutions, uncovered).all());

  return {
    shots: drawn,
    diagnostics,
    substitutions,
    uncovered,
    remaining,
    pulled,
  };
}

/**
 * What to say about a draw. One line per pair rather than per shot, because a
 * ripple of ten that came out of a different case is one decision a shooter
 * makes once, and ten identical warnings would bury the one that is not.
 */
export function checkDraw(
  substitutions: readonly Substitution[],
  uncovered: readonly Uncovered[],
): DiagnosticBag {
  const diagnostics = new DiagnosticBag();
  for (const substitution of substitutions) {
    const message = `${substitution.effectId} short ${substitution.count}, drawing ${plural(substitution.count, "shot")} of ${substitution.standIn.id} instead`;
    if (substitution.quality === "exact") {
      diagnostics.note({ code: "PF1601", message });
    } else {
      diagnostics.warning({
        code: "PF1602",
        message,
        help: `${substitution.standIn.id} is a different calibre in the same band, so check the separation`,
      });
    }
  }
  for (const line of uncovered) {
    diagnostics.error({
      code: "PF1600",
      message: `nothing in stock can stand in for ${line.effectId}, ${plural(line.short, "shot")} short`,
      help: "redesign the cue, buy in, or set fewer of them",
      ...(line.origin === undefined ? {} : { span: line.origin }),
    });
  }
  return diagnostics;
}

/** A line a crew can read, for a report that is not a diagnostic. */
export function describeDraw(result: DrawResult): string {
  const lines: string[] = [];
  for (const substitution of result.substitutions) {
    lines.push(
      `${substitution.effectId}: ${plural(substitution.count, "shot")} fired as ${substitution.standIn.id} from ${substitution.lots.join(", ")}`,
    );
  }
  for (const line of result.uncovered) {
    lines.push(`${line.effectId}: ${plural(line.short, "shot")} uncovered`);
  }
  return lines.length === 0
    ? "every cue drew what the script asked for"
    : lines.join("\n");
}
