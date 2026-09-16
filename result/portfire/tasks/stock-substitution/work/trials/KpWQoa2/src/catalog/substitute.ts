import { bandOf, sameCalibre } from "./calibre.js";
import type { Effect } from "./effect.js";
import { calibreOf, isAerial, shotCount } from "./effect.js";
import type { Magazine } from "./inventory.js";
import type { Catalog } from "./registry.js";
import { timingOf } from "./timing.js";
import { DiagnosticBag } from "../core/diagnostic.js";
import { compareIds } from "../core/ids.js";
import { raw } from "../core/units.js";

/**
 * What to fire instead.
 *
 * A show is designed against a catalog and fired against a magazine, and those
 * two are never the same. A lot arrives short, a case gets damaged in the van,
 * or the design calls for forty of something the crew has thirty of. The
 * question then is what else will do, and it is asked at the worst possible
 * moment, usually the afternoon of the show.
 *
 * A substitute has to match on the things that would change the show if they
 * changed: the calibre, because that changes both the timing and the
 * separation distance, and roughly the flight time, because a substitute that
 * climbs half a second longer breaks half a second late. It does not have to
 * match on colour or break style, because a designer looking at a list can
 * judge those and a program cannot.
 */

export interface SubstituteOptions {
  /** How far the flight time may differ, in milliseconds. */
  readonly leadToleranceMs?: number;
  /** Allow a different calibre in the same handling band. */
  readonly allowBandMatch?: boolean;
  /** Only suggest effects the magazine actually holds. */
  readonly magazine?: Magazine;
  /** How many are wanted, so a suggestion with two left is not offered. */
  readonly wanted?: number;
}

export interface Substitute {
  readonly effect: Effect;
  /** Exact when the calibre matches, near when only the band does. */
  readonly quality: "exact" | "near";
  readonly leadDifferenceMs: number;
  readonly onHand?: number;
}

const DEFAULT_LEAD_TOLERANCE_MS = 400;

export function substitutesFor(
  wanted: Effect,
  catalog: Catalog,
  options: SubstituteOptions = {},
): Substitute[] {
  const tolerance = options.leadToleranceMs ?? DEFAULT_LEAD_TOLERANCE_MS;
  const wantedCalibre = calibreOf(wanted);
  const wantedLead = raw(timingOf(wanted).lead);
  const found: Substitute[] = [];

  for (const candidate of catalog.all()) {
    if (candidate.id === wanted.id || candidate.kind !== wanted.kind) {
      continue;
    }
    if (shotCount(candidate) !== shotCount(wanted)) {
      continue;
    }
    const candidateCalibre = calibreOf(candidate);
    let quality: "exact" | "near" | undefined;
    if (wantedCalibre === undefined && candidateCalibre === undefined) {
      quality = "exact";
    } else if (
      wantedCalibre !== undefined &&
      candidateCalibre !== undefined &&
      sameCalibre(wantedCalibre, candidateCalibre)
    ) {
      quality = "exact";
    } else if (
      (options.allowBandMatch ?? true) &&
      wantedCalibre !== undefined &&
      candidateCalibre !== undefined &&
      bandOf(wantedCalibre) === bandOf(candidateCalibre)
    ) {
      quality = "near";
    }
    if (quality === undefined) {
      continue;
    }
    const difference = Math.abs(raw(timingOf(candidate).lead) - wantedLead);
    if (difference > tolerance) {
      continue;
    }
    const onHand = options.magazine?.onHand(candidate.id);
    if (onHand !== undefined && onHand < (options.wanted ?? 1)) {
      continue;
    }
    found.push({
      effect: candidate,
      quality,
      leadDifferenceMs: difference,
      ...(onHand === undefined ? {} : { onHand }),
    });
  }

  return found.sort((a, b) => {
    if (a.quality !== b.quality) {
      return a.quality === "exact" ? -1 : 1;
    }
    if (a.leadDifferenceMs !== b.leadDifferenceMs) {
      return a.leadDifferenceMs - b.leadDifferenceMs;
    }
    return compareIds(a.effect.id, b.effect.id);
  });
}

/**
 * The best single suggestion, or nothing. Callers that want to show a list use
 * `substitutesFor`; this is for the automatic case, where taking the first is
 * the whole decision.
 */
export function bestSubstitute(
  wanted: Effect,
  catalog: Catalog,
  options: SubstituteOptions = {},
): Substitute | undefined {
  return substitutesFor(wanted, catalog, options)[0];
}

export interface SubstitutionPlan {
  readonly effectId: string;
  readonly short: number;
  readonly substitute?: Substitute;
}

/**
 * Work through a shortfall and say what covers each line. A line with no
 * substitute is left in the plan without one, because the crew still has to
 * see it.
 */
export function planSubstitutions(
  shortfall: ReadonlyMap<string, number>,
  catalog: Catalog,
  magazine: Magazine,
  options: SubstituteOptions = {},
): SubstitutionPlan[] {
  const plans: SubstitutionPlan[] = [];
  for (const [effectId, short] of [...shortfall.entries()].sort((a, b) =>
    compareIds(a[0], b[0]),
  )) {
    const wanted = catalog.get(effectId);
    if (wanted === undefined) {
      plans.push({ effectId, short });
      continue;
    }
    const substitute = bestSubstitute(wanted, catalog, {
      ...options,
      magazine,
      wanted: short,
    });
    plans.push({
      effectId,
      short,
      ...(substitute === undefined ? {} : { substitute }),
    });
  }
  return plans;
}

export function checkSubstitutions(
  plans: readonly SubstitutionPlan[],
): DiagnosticBag {
  const diagnostics = new DiagnosticBag();
  for (const plan of plans) {
    if (plan.substitute === undefined) {
      diagnostics.error({
        code: "PF1600",
        message: `nothing in stock can stand in for ${plan.effectId}`,
        help: "redesign the cue, or buy in",
      });
      continue;
    }
    const severity = plan.substitute.quality === "exact" ? "note" : "warning";
    const message = `${plan.effectId} short ${plan.short}, use ${plan.substitute.effect.id}`;
    if (severity === "note") {
      diagnostics.note({ code: "PF1601", message });
    } else {
      diagnostics.warning({
        code: "PF1602",
        message,
        help: `${plan.substitute.effect.id} is a different calibre in the same band, so check the separation`,
      });
    }
  }
  return diagnostics;
}

/** Whether swapping one effect for another changes what the safety layer sees. */
export function changesSafety(from: Effect, to: Effect): boolean {
  const a = calibreOf(from);
  const b = calibreOf(to);
  if (a === undefined || b === undefined) {
    return a !== b;
  }
  if (!sameCalibre(a, b)) {
    return true;
  }
  return (
    isAerial(from) &&
    isAerial(to) &&
    raw(from.breakDiameter) !== raw(to.breakDiameter)
  );
}
