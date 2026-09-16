import { bandOf } from "./calibre.js";
import type { Effect } from "./effect.js";
import { calibreOf, isAerial, isGround, shotCount } from "./effect.js";
import { DiagnosticBag } from "../core/diagnostic.js";
import { compareIds } from "../core/ids.js";
import { raw } from "../core/units.js";

/**
 * Transport and storage classification.
 *
 * Fireworks are explosives, and the paperwork follows the UN scheme rather
 * than anything a pyrotechnician would have designed. A display shell is
 * hazard division 1.3G under UN0335, a large salute can be 1.1G under UN0333,
 * and consumer sized items are 1.4G or 1.4S. The division decides how much may
 * be in one store, how far the store sits from anything else, and what a
 * vehicle carrying it has to be.
 *
 * The number that everything hangs off is net explosive quantity, the weight
 * of the composition rather than of the packaged item. Nobody weighs it on the
 * night, so it is estimated from calibre, and this estimate is deliberately on
 * the high side. A store that turns out to hold more than its licence allows
 * is a criminal matter, not a paperwork one.
 */

export type HazardDivision = "1.1G" | "1.2G" | "1.3G" | "1.4G" | "1.4S";

export interface HazardClass {
  readonly division: HazardDivision;
  /** The UN number that goes on the package and the transport document. */
  readonly unNumber: string;
}

const DIVISIONS: Record<HazardDivision, string> = {
  "1.1G": "UN0333",
  "1.2G": "UN0334",
  "1.3G": "UN0335",
  "1.4G": "UN0336",
  "1.4S": "UN0337",
};

export function hazardClass(division: HazardDivision): HazardClass {
  return { division, unNumber: DIVISIONS[division] };
}

/**
 * Net explosive quantity in grams, estimated from the item.
 *
 * A shell's composition scales with the cube of its calibre, which is why a
 * twelve inch is not twice a six inch but eight times it. The constant is
 * fitted so a 75mm comes out near 60 grams and a 150mm near 480, which is the
 * range display shells actually sit in.
 */
export function netExplosiveGrams(effect: Effect): number {
  if (isGround(effect)) {
    return 30;
  }
  const size = calibreOf(effect);
  const bore = size === undefined ? 50 : raw(size.size);
  const perShot = 0.000142 * bore ** 3;
  return Math.round(perShot * shotCount(effect));
}

/**
 * Which division an item falls into. A large salute is a mass explosion risk
 * and goes to 1.1G. Everything else in display sizes is 1.3G. Small consumer
 * items are 1.4G, and only the smallest, in their own packaging, are 1.4S.
 */
export function divisionFor(effect: Effect): HazardDivision {
  if (isGround(effect)) {
    return netExplosiveGrams(effect) <= 30 ? "1.4S" : "1.4G";
  }
  const size = calibreOf(effect);
  if (size === undefined) {
    return "1.4G";
  }
  if (isAerial(effect) && effect.breakStyle === "salute") {
    const band = bandOf(size);
    if (band === "large" || band === "salute-class") {
      return "1.1G";
    }
  }
  if (raw(size.size) < 50) {
    return "1.4G";
  }
  return "1.3G";
}

export function classFor(effect: Effect): HazardClass {
  return hazardClass(divisionFor(effect));
}

export interface HazardTotals {
  /** Net explosive quantity in grams, by division. */
  readonly byDivision: ReadonlyMap<HazardDivision, number>;
  readonly totalGrams: number;
  /** The most restrictive division present, which sets the store. */
  readonly worst?: HazardDivision;
}

const SEVERITY: readonly HazardDivision[] = [
  "1.1G",
  "1.2G",
  "1.3G",
  "1.4G",
  "1.4S",
];

export function hazardTotals(
  effects: Iterable<Effect>,
  counts?: ReadonlyMap<string, number>,
): HazardTotals {
  const byDivision = new Map<HazardDivision, number>();
  let total = 0;
  let worst: HazardDivision | undefined;
  for (const effect of effects) {
    const many = counts?.get(effect.id) ?? 1;
    const grams = netExplosiveGrams(effect) * many;
    const division = divisionFor(effect);
    byDivision.set(division, (byDivision.get(division) ?? 0) + grams);
    total += grams;
    if (
      worst === undefined ||
      SEVERITY.indexOf(division) < SEVERITY.indexOf(worst)
    ) {
      worst = division;
    }
  }
  return {
    byDivision,
    totalGrams: total,
    ...(worst === undefined ? {} : { worst }),
  };
}

export interface StoreLicence {
  /** Net explosive quantity the store may hold, in kilograms. */
  readonly capacityKg: number;
  /** Divisions the licence covers. */
  readonly divisions: readonly HazardDivision[];
}

export function checkStore(
  totals: HazardTotals,
  licence: StoreLicence,
): DiagnosticBag {
  const diagnostics = new DiagnosticBag();
  const kilos = totals.totalGrams / 1000;
  if (kilos > licence.capacityKg) {
    diagnostics.error({
      code: "PF1700",
      message: `the show is ${kilos.toFixed(1)}kg net and the store holds ${licence.capacityKg}kg`,
      help: "split the delivery, or store the balance elsewhere under its own licence",
    });
  } else if (kilos > licence.capacityKg * 0.9) {
    diagnostics.warning({
      code: "PF1701",
      message: `the show is ${kilos.toFixed(1)}kg net, within a tenth of the ${licence.capacityKg}kg limit`,
    });
  }
  for (const division of [...totals.byDivision.keys()].sort()) {
    if (!licence.divisions.includes(division)) {
      diagnostics.error({
        code: "PF1702",
        message: `the show holds ${division} and the licence does not cover it`,
        help: `the licence covers ${licence.divisions.join(", ")}`,
      });
    }
  }
  return diagnostics;
}

/** A line per division for the transport document. */
export function transportLines(totals: HazardTotals): string[] {
  return [...totals.byDivision.entries()]
    .sort((a, b) => SEVERITY.indexOf(a[0]) - SEVERITY.indexOf(b[0]))
    .map(
      ([division, grams]) =>
        `${DIVISIONS[division]} ${division}, ${(grams / 1000).toFixed(2)}kg net`,
    );
}

/** The heaviest items in a show, which is where a reduction has to come from. */
export function heaviestItems(
  effects: Iterable<Effect>,
  counts?: ReadonlyMap<string, number>,
  limit = 5,
): { readonly effectId: string; readonly grams: number }[] {
  return [...effects]
    .map((effect) => ({
      effectId: effect.id,
      grams: netExplosiveGrams(effect) * (counts?.get(effect.id) ?? 1),
    }))
    .sort((a, b) => b.grams - a.grams || compareIds(a.effectId, b.effectId))
    .slice(0, limit);
}
