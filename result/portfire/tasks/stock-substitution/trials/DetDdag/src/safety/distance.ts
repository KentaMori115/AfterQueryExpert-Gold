import type { Calibre } from "../catalog/calibre.js";
import { bandOf, calibre } from "../catalog/calibre.js";
import type { Effect } from "../catalog/effect.js";
import { calibreOf, isGround, isMine } from "../catalog/effect.js";
import type { Metres } from "../core/units.js";
import { feet, metres, mm, raw, toFeet } from "../core/units.js";

/**
 * How far the audience has to be.
 *
 * The American rule is the one everyone quotes, and it is simple enough to
 * remember on a site walk. Seventy feet of separation for every inch of
 * internal mortar diameter, measured from the mortar to the nearest spectator.
 * A six inch shell wants four hundred and twenty feet, which is a hundred and
 * twenty eight metres, which is further than most people guess.
 *
 * The European figures are not the same number and they are not derived the
 * same way, so both are here rather than one converted into the other. A crew
 * shooting to a permit written against one of them cannot use the other, and
 * quietly converting between them is how a site ends up short.
 */

export type DistanceRule = "nfpa-1123" | "cen-category-4" | "reduced";

/** Feet of separation per inch of bore, the NFPA 1123 figure. */
const NFPA_FEET_PER_INCH = 70;

/**
 * The reduced figure for a site that has been surveyed and has the fallout
 * area under control. Halving is the most any authority allows and it needs a
 * written justification, so it is never the default.
 */
const REDUCED_FACTOR = 0.5;

/**
 * The European table is banded rather than linear, and the bands are wider at
 * the top. These are the distances in metres for the top of each band.
 */
const CEN_TABLE: readonly (readonly [number, number])[] = [
  [50, 25],
  [75, 50],
  [100, 75],
  [125, 100],
  [150, 125],
  [200, 175],
  [250, 225],
  [300, 275],
  [400, 350],
];

export function separationFor(
  value: Calibre,
  rule: DistanceRule = "nfpa-1123",
): Metres {
  const size = raw(value.size);
  switch (rule) {
    case "nfpa-1123":
      return feet(toInchesRounded(size) * NFPA_FEET_PER_INCH);
    case "reduced":
      return feet(toInchesRounded(size) * NFPA_FEET_PER_INCH * REDUCED_FACTOR);
    case "cen-category-4": {
      for (const [top, distance] of CEN_TABLE) {
        if (size <= top) {
          return metres(distance);
        }
      }
      const last = CEN_TABLE[CEN_TABLE.length - 1];
      return metres(last === undefined ? 0 : last[1]);
    }
  }
}

/**
 * Bore in inches, rounded up to the next half inch. Rounding up matters. A
 * shell quoted as 152mm is a six inch shell and takes the six inch distance,
 * and rounding down would take five and a half.
 */
function toInchesRounded(sizeMm: number): number {
  return Math.ceil((sizeMm / 25.4) * 2) / 2;
}

/**
 * A mine goes off at the muzzle and throws outward rather than upward, so its
 * separation is driven by the spread rather than the bore. A ground piece has
 * no bore at all and takes a flat figure.
 */
export function separationForEffect(
  effect: Effect,
  rule: DistanceRule = "nfpa-1123",
): Metres {
  if (isGround(effect)) {
    return metres(25);
  }
  const size = calibreOf(effect);
  if (size === undefined) {
    return metres(25);
  }
  const base = raw(separationFor(size, rule));
  if (isMine(effect)) {
    // A mine's stars land inside its own cone, so the bore figure is more than
    // it needs, but the cone itself has to clear the line.
    const reach =
      raw(effect.height) * Math.tan((effect.spreadAngle * Math.PI) / 360);
    return metres(Math.max(base * 0.6, reach * 2, 25));
  }
  return metres(base);
}

/** The largest separation any effect in a set needs, which sets the site. */
export function worstSeparation(
  effects: Iterable<Effect>,
  rule: DistanceRule = "nfpa-1123",
): Metres {
  let worst = 0;
  for (const effect of effects) {
    worst = Math.max(worst, raw(separationForEffect(effect, rule)));
  }
  return metres(worst);
}

/**
 * The largest bore a site of a given radius can take under a rule, in
 * millimetres. This is the question a crew actually asks on arriving at a
 * field, and answering it by search rather than by inverting the rule keeps
 * the banded European table and the linear American one on one code path.
 */
export function largestCalibreFor(
  available: Metres,
  rule: DistanceRule = "nfpa-1123",
): number {
  let best = 0;
  for (let size = 25; size <= 400; size += 1) {
    if (raw(separationFor(calibre(mm(size)), rule)) <= raw(available)) {
      best = size;
    }
  }
  return best;
}

export function describeSeparation(
  value: Calibre,
  rule: DistanceRule = "nfpa-1123",
): string {
  const distance = separationFor(value, rule);
  const metresPart = raw(distance).toFixed(0);
  const feetPart = toFeet(distance).toFixed(0);
  return `${value.inchLabel}in needs ${metresPart}m (${feetPart}ft) under ${rule}`;
}

/** Whether a bore is in the band that needs a written reduced justification. */
export function needsJustification(value: Calibre): boolean {
  return bandOf(value) === "large" || bandOf(value) === "salute-class";
}
