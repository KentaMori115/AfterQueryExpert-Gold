import type { Magazine } from "./inventory.js";
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
 * Drawing the show out of the magazine.
 *
 * A show is designed against the house catalog and fired out of whatever the
 * magazine actually holds, and those two are never the same by the afternoon of
 * the show. Until now the compiler only knew the catalog, so it would happily
 * produce a firing table for four hundred shells when the store held three
 * hundred and eighty, and the crew found out while loading.
 *
 * So the shots get drawn, one round at a time, in firing order. Firing order
 * matters because stock runs out mid show rather than tidily: the cue that goes
 * without is the last one, not the first, which is also what a shooter would do
 * standing at the racks. Every cue draws its own shell first, and only when the
 * whole show has had its turn does anything go back for a stand-in, because a
 * stand-in taken early can rob a later cue of the shell it was written for.
 *
 * A drawn round carries its lot number from here to the cue sheet. That is a
 * legal requirement rather than a nicety: if one shell misbehaves, the lot has
 * to be traceable, and a sheet that says which lot went into which tube is the
 * difference between pulling one case and pulling the magazine.
 */

export interface DrawOptions {
  /**
   * Lot numbers set aside before anything is drawn: recalled, damaged, or held
   * back for the next show. Setting a lot aside here rather than editing the
   * book means the book on disk stays the record of what was delivered.
   */
  readonly pull?: readonly string[];
  /**
   * How far a stand-in may stray. The defaults are the ones `substitutesFor`
   * uses, which is what a designer looking at a list would be offered.
   */
  readonly substitutes?: SubstituteOptions;
}

/** One asked for effect, one stand-in, and how many cues went that way. */
export interface Substitution {
  readonly asked: string;
  readonly used: string;
  /** Exact when the calibre matches, near when only the handling band does. */
  readonly quality: "exact" | "near";
  readonly count: number;
  /** The first cue that went short, so a report can point at the script. */
  readonly where?: Span;
}

/** An effect the magazine ran out of and nothing else could cover. */
export interface Uncovered {
  readonly effectId: string;
  readonly count: number;
  readonly where?: Span;
}

export interface ShowDraw {
  /** The shots as fired: a stand-in where one was needed, a lot on each. */
  readonly shots: readonly ResolvedShot[];
  /** What is left in the magazine once the show has been drawn out of it. */
  readonly remaining: Magazine;
  readonly substitutions: readonly Substitution[];
  readonly uncovered: readonly Uncovered[];
  readonly diagnostics: DiagnosticBag;
}

interface Pending {
  readonly shot: ResolvedShot;
  readonly index: number;
}

/**
 * Firing order, which is visible time and then the order the script wrote them
 * in. Lift compensation has not happened yet, and it must not decide this: two
 * cues on the same beat should go short in the order they were written rather
 * than in the order their shells happen to climb.
 */
function firingOrder(shots: readonly ResolvedShot[]): Pending[] {
  return shots
    .map((shot, index) => ({ shot, index }))
    .sort((a, b) => {
      const gap = raw(a.shot.at) - raw(b.shot.at);
      return gap !== 0 ? gap : a.index - b.index;
    });
}

/**
 * Set the pulled lots aside, on a copy, and say what could not be found. A lot
 * number nobody holds is worth a warning: it is usually a typo, and a typo in a
 * recall means the recalled shells are still in the show.
 */
export function setAside(
  magazine: Magazine,
  pull: readonly string[],
): { readonly magazine: Magazine; readonly diagnostics: DiagnosticBag } {
  const diagnostics = new DiagnosticBag();
  const held = magazine.clone();
  for (const asked of pull) {
    const lotNumber = asked.trim().toLowerCase();
    if (lotNumber.length === 0) {
      continue;
    }
    if (held.byLotNumber(lotNumber).length === 0) {
      diagnostics.warning({
        code: "PF1603",
        message: `the magazine holds no lot ${lotNumber} to set aside`,
        help: "check the lot number, an unrecognised one sets nothing aside",
      });
      continue;
    }
    held.quarantine(lotNumber);
  }
  return { magazine: held, diagnostics };
}

export function drawShots(
  shots: readonly ResolvedShot[],
  catalog: Catalog,
  magazine: Magazine,
  options: DrawOptions = {},
): ShowDraw {
  const pulled = setAside(magazine, options.pull ?? []);
  const remaining = pulled.magazine;
  const drawn: ResolvedShot[] = [...shots];
  const ordered = firingOrder(shots);

  // First pass: every cue draws what the script asked for, while it lasts.
  const pending: Pending[] = [];
  for (const entry of ordered) {
    const lot = remaining.draw(entry.shot.effect);
    if (lot === undefined) {
      pending.push(entry);
      continue;
    }
    drawn[entry.index] = { ...entry.shot, lot };
  }

  // Second pass: the cues left short, in the same order, take a stand-in. The
  // candidate list only depends on the catalog, so it is worked out once per
  // effect; which of the candidates is available changes as stock goes, which
  // is why one shortfall can end up spread across several stand-ins.
  const candidates = new Map<string, readonly Substitute[]>();
  const substitutions = new Map<string, Substitution>();
  const uncovered = new Map<string, Uncovered>();
  for (const entry of pending) {
    const asked = entry.shot.effect;
    let offered = candidates.get(asked);
    if (offered === undefined) {
      offered = substitutesFor(
        entry.shot.resolved,
        catalog,
        options.substitutes ?? {},
      );
      candidates.set(asked, offered);
    }
    let covered = false;
    for (const candidate of offered) {
      const lot = remaining.draw(candidate.effect.id);
      if (lot === undefined) {
        continue;
      }
      drawn[entry.index] = {
        ...entry.shot,
        effect: candidate.effect.id,
        resolved: candidate.effect,
        substitutedFor: asked,
        lot,
      };
      const key = `${asked}\u0000${candidate.effect.id}`;
      const already = substitutions.get(key);
      substitutions.set(
        key,
        already === undefined
          ? {
              asked,
              used: candidate.effect.id,
              quality: candidate.quality,
              count: 1,
              where: entry.shot.origin,
            }
          : { ...already, count: already.count + 1 },
      );
      covered = true;
      break;
    }
    if (covered) {
      continue;
    }
    // Nothing covers it, so the cue keeps the shell it was written with. The
    // table stays readable and the error says it cannot be fired as it stands.
    const short = uncovered.get(asked);
    uncovered.set(
      asked,
      short === undefined
        ? { effectId: asked, count: 1, where: entry.shot.origin }
        : { ...short, count: short.count + 1 },
    );
  }

  const swaps = [...substitutions.values()].sort((a, b) => {
    const byAsked = compareIds(a.asked, b.asked);
    return byAsked !== 0 ? byAsked : compareIds(a.used, b.used);
  });
  const missing = [...uncovered.values()].sort((a, b) =>
    compareIds(a.effectId, b.effectId),
  );
  const diagnostics = new DiagnosticBag()
    .addAll(pulled.diagnostics.all())
    .addAll(checkDraw(swaps, missing).all());

  return {
    shots: drawn,
    remaining,
    substitutions: swaps,
    uncovered: missing,
    diagnostics,
  };
}

/**
 * What to say about a draw. One line per pair rather than per cue, because a
 * finale that swaps forty shells is one decision to check and forty lines of
 * the same sentence is how a report gets skimmed.
 */
export function checkDraw(
  substitutions: readonly Substitution[],
  uncovered: readonly Uncovered[],
): DiagnosticBag {
  const diagnostics = new DiagnosticBag();
  for (const swap of substitutions) {
    const message = `${swap.asked} short ${swap.count}, use ${swap.used}`;
    if (swap.quality === "exact") {
      diagnostics.note({
        code: "PF1601",
        message,
        ...(swap.where === undefined ? {} : { span: swap.where }),
      });
      continue;
    }
    diagnostics.warning({
      code: "PF1602",
      message,
      help: `${swap.used} is a different calibre in the same band, so check the separation`,
      ...(swap.where === undefined ? {} : { span: swap.where }),
    });
  }
  for (const line of uncovered) {
    diagnostics.error({
      code: "PF1600",
      message: `nothing in stock can stand in for ${line.effectId}, ${plural(line.count, "cue")} short`,
      help: "redesign those cues, buy in, or set fewer lots aside",
      ...(line.where === undefined ? {} : { span: line.where }),
    });
  }
  return diagnostics;
}

/** A few lines a report or a command can print about what was drawn. */
export function describeDraw(draw: ShowDraw): string {
  const lines: string[] = [];
  const lots = new Set(
    draw.shots
      .map((shot) => shot.lot)
      .filter((lot): lot is string => lot !== undefined),
  );
  const substituted = draw.shots.filter(
    (shot) => shot.substitutedFor !== undefined,
  ).length;
  lines.push(
    `drawn from ${plural(lots.size, "lot")}, ${substituted} of ${draw.shots.length} cues on a stand-in`,
  );
  for (const swap of draw.substitutions) {
    lines.push(
      `${swap.asked} short ${swap.count}, firing ${swap.used} instead (${swap.quality === "exact" ? "same calibre" : "same band"})`,
    );
  }
  for (const line of draw.uncovered) {
    lines.push(`${line.effectId} short ${line.count} with nothing to stand in`);
  }
  return lines.join("\n");
}
