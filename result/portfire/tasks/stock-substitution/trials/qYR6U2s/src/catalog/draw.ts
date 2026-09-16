import type { Lot, Magazine } from "./inventory.js";
import type { Catalog } from "./registry.js";
import type {
  Substitute,
  SubstituteOptions,
  SubstitutionPlan,
} from "./substitute.js";
import { checkSubstitutions, substitutesFor } from "./substitute.js";
import type { DiagnosticBag } from "../core/diagnostic.js";
import { compareIds } from "../core/ids.js";
import { raw } from "../core/units.js";
import type { ResolvedShot } from "../script/resolve.js";

/**
 * Drawing the show out of the magazine.
 *
 * A show is designed against the house catalog and fired out of whatever the
 * magazine happens to hold, and until the shells are on the field those are two
 * different lists. Somebody used to reconcile them by hand the week of the
 * show, which is how a crew arrives at a field with thirty of something the
 * script asks for forty of.
 *
 * So the compiler draws. Every cue takes its own shell while the stock lasts,
 * in firing order, and the cues that come up empty are the late ones, because a
 * shooter would rather lose the fortieth shot of a ripple than the shot that
 * opens the show. Only when every cue has had its own turn does the draw go
 * back for the ones left short and look for a stand in, which is the right
 * order: lending a six inch palm to an earlier cue before a later cue has asked
 * for its own palm would take a shell out of the hands of the cue it was bought
 * for.
 *
 * A stand in is spent stock like any other, so one shortfall can end up covered
 * by two or three different shells. That is what happens on a field as well.
 */

export interface DrawOptions {
  readonly catalog: Catalog;
  /** The book. It is copied, never spent, so a caller can draw twice. */
  readonly magazine: Magazine;
  /**
   * Lot numbers set aside before anything is drawn, which is what a recall or a
   * damaged case means. Pulling a lot here rather than editing the book keeps
   * the book the legal record it is.
   */
  readonly pull?: readonly string[];
  /** How wide a stand in may be. The defaults are what a shooter would accept. */
  readonly substitutes?: SubstituteOptions;
}

/** One asked for and stand in pair, with how many shots it covered. */
export interface Substitution {
  /** What the script asked for. */
  readonly asked: string;
  /** What was drawn instead. */
  readonly used: string;
  readonly quality: "exact" | "near";
  readonly count: number;
  /** The lots the stand ins came from, in the order they were drawn. */
  readonly lots: readonly string[];
}

/** An effect the draw could not cover, by any shell in the magazine. */
export interface DrawShortfall {
  readonly effectId: string;
  readonly short: number;
}

export interface Draw {
  /**
   * The shots as they will be fired: the same cues at the same times, each
   * carrying the lot it was drawn from and, where it is a stand in, what the
   * script had asked for.
   */
  readonly shots: readonly ResolvedShot[];
  readonly diagnostics: DiagnosticBag;
  readonly substitutions: readonly Substitution[];
  readonly shortfalls: readonly DrawShortfall[];
  /** What is left in the copy of the book once the show has been drawn. */
  readonly remaining: Magazine;
  /** How many units the show drew, own shell or stand in. */
  readonly drawn: number;
  /** How many units the pull set aside before the draw began. */
  readonly pulled: number;
}

/**
 * Firing order, which is what the audience sees and therefore what a shortfall
 * has to be measured along. Two cues at the same moment keep the order they
 * were written in, so a draw is the same every time it is run.
 */
function firingOrder(shots: readonly ResolvedShot[]): number[] {
  return shots
    .map((_, index) => index)
    .sort((a, b) => {
      const first = shots[a];
      const second = shots[b];
      if (first === undefined || second === undefined) {
        return a - b;
      }
      const gap = raw(first.at) - raw(second.at);
      return gap !== 0 ? gap : a - b;
    });
}

function pairKey(asked: string, used: string): string {
  return `${asked}\u0000${used}`;
}

interface Pair {
  readonly asked: string;
  readonly substitute: Substitute;
  readonly lots: string[];
  count: number;
}

export function drawShow(
  shots: readonly ResolvedShot[],
  options: DrawOptions,
): Draw {
  const remaining = options.magazine.clone();
  let pulled = 0;
  for (const lotNumber of options.pull ?? []) {
    pulled += remaining.quarantine(lotNumber.trim().toLowerCase());
  }

  const drawn: ResolvedShot[] = [...shots];
  const short: number[] = [];
  let units = 0;

  // Every cue takes its own shell first, in firing order.
  for (const index of firingOrder(shots)) {
    const shot = shots[index];
    if (shot === undefined) {
      continue;
    }
    const lot = one(remaining, shot.resolved.id);
    if (lot === undefined) {
      short.push(index);
      continue;
    }
    drawn[index] = { ...shot, lot: lot.lotNumber };
    units += 1;
  }

  // Then, and only then, the cues left short look for something to stand in.
  const pairs = new Map<string, Pair>();
  const missing = new Map<string, number>();
  const offers = new Map<string, Substitute[]>();
  for (const index of short) {
    const shot = shots[index];
    if (shot === undefined) {
      continue;
    }
    const asked = shot.effect;
    let candidates = offers.get(shot.resolved.id);
    if (candidates === undefined) {
      candidates = substitutesFor(
        shot.resolved,
        options.catalog,
        options.substitutes ?? {},
      );
      offers.set(shot.resolved.id, candidates);
    }
    let covered: { substitute: Substitute; lot: Lot } | undefined;
    for (const candidate of candidates) {
      const lot = one(remaining, candidate.effect.id);
      if (lot !== undefined) {
        covered = { substitute: candidate, lot };
        break;
      }
    }
    if (covered === undefined) {
      missing.set(asked, (missing.get(asked) ?? 0) + 1);
      continue;
    }
    // The cue keeps its time and its height clause and lifts on the stand in's
    // own lead, which is the whole reason a stand in has to be close on lead.
    drawn[index] = {
      ...shot,
      effect: covered.substitute.effect.id,
      resolved: covered.substitute.effect,
      substitutedFor: asked,
      lot: covered.lot.lotNumber,
    };
    units += 1;
    const key = pairKey(asked, covered.substitute.effect.id);
    const pair = pairs.get(key);
    if (pair === undefined) {
      pairs.set(key, {
        asked,
        substitute: covered.substitute,
        lots: [covered.lot.lotNumber],
        count: 1,
      });
    } else {
      pair.count += 1;
      pair.lots.push(covered.lot.lotNumber);
    }
  }

  const plans = report(pairs, missing);
  return {
    shots: drawn,
    diagnostics: checkSubstitutions(plans),
    substitutions: [...pairs.values()]
      .map((pair) => ({
        asked: pair.asked,
        used: pair.substitute.effect.id,
        quality: pair.substitute.quality,
        count: pair.count,
        lots: [...pair.lots],
      }))
      .sort(
        (a, b) => compareIds(a.asked, b.asked) || compareIds(a.used, b.used),
      ),
    shortfalls: [...missing.entries()]
      .map(([effectId, count]) => ({ effectId, short: count }))
      .sort((a, b) => compareIds(a.effectId, b.effectId)),
    remaining,
    drawn: units,
    pulled,
  };
}

/**
 * The plans behind the diagnostics, in the order a person reads them: one
 * effect at a time, what stood in for it, then what nothing stood in for.
 */
function report(
  pairs: ReadonlyMap<string, Pair>,
  missing: ReadonlyMap<string, number>,
): SubstitutionPlan[] {
  const asked = [
    ...new Set([
      ...[...pairs.values()].map((pair) => pair.asked),
      ...missing.keys(),
    ]),
  ].sort(compareIds);
  const plans: SubstitutionPlan[] = [];
  for (const effectId of asked) {
    const covered = [...pairs.values()]
      .filter((pair) => pair.asked === effectId)
      .sort((a, b) =>
        compareIds(a.substitute.effect.id, b.substitute.effect.id),
      );
    for (const pair of covered) {
      plans.push({
        effectId,
        short: pair.count,
        substitute: pair.substitute,
      });
    }
    const left = missing.get(effectId);
    if (left !== undefined) {
      plans.push({ effectId, short: left });
    }
  }
  return plans;
}

/** One unit of an effect, or nothing when the magazine has none left. */
function one(magazine: Magazine, effectId: string): Lot | undefined {
  return magazine.draw(effectId, 1)[0];
}

export function describeDraw(draw: Draw): string {
  const lines = [
    `${draw.drawn} drawn from the magazine`,
    ...(draw.pulled === 0 ? [] : [`${draw.pulled} set aside by the pull`]),
    ...draw.substitutions.map(
      (entry) =>
        `${entry.count} of ${entry.asked} fired as ${entry.used} (${entry.quality === "exact" ? "same calibre" : "same band"})`,
    ),
    ...draw.shortfalls.map(
      (line) => `${line.short} of ${line.effectId} with nothing to stand in`,
    ),
  ];
  return lines.join("\n");
}
