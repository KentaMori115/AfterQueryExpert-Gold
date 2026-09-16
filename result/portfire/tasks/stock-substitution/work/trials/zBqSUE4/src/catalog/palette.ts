import { bandOf } from "./calibre.js";
import type { BreakStyle, Effect } from "./effect.js";
import { calibreOf, isAerial, isGround } from "./effect.js";
import { countBy, rankedEntries } from "../core/collect.js";
import { DiagnosticBag } from "../core/diagnostic.js";
import { renderTable } from "../core/text.js";
import { plural } from "../core/text.js";

/**
 * How varied a show is.
 *
 * Every designer has favourites, and a show written over six weeks drifts
 * towards them without anybody noticing. The result is technically fine and
 * reads as monotonous, because the eye stops registering the fourth willow in
 * a row as a new thing.
 *
 * What matters is not the count of distinct effects. A show can use twenty
 * effects that all look the same and three that do not. So the measure here is
 * over the visual families, and the families are grouped by what they look
 * like rather than by what a catalogue calls them.
 */

export type Family =
  | "burst"
  | "trailing"
  | "ringed"
  | "flashing"
  | "report"
  | "low"
  | "ground";

const FAMILY_OF: Record<BreakStyle, Family> = {
  peony: "burst",
  chrysanthemum: "burst",
  dahlia: "burst",
  willow: "trailing",
  kamuro: "trailing",
  palm: "trailing",
  brocade: "trailing",
  crossette: "ringed",
  ring: "ringed",
  strobe: "flashing",
  salute: "report",
};

export function familyOf(effect: Effect): Family {
  if (isGround(effect)) {
    return "ground";
  }
  if (isAerial(effect)) {
    return FAMILY_OF[effect.breakStyle];
  }
  return "low";
}

export interface PaletteEntry {
  readonly family: Family;
  readonly shots: number;
  readonly share: number;
}

export function palette(
  effects: Iterable<Effect>,
  counts?: ReadonlyMap<string, number>,
): PaletteEntry[] {
  const shots = new Map<Family, number>();
  let total = 0;
  for (const effect of effects) {
    const many = counts?.get(effect.id) ?? 1;
    const family = familyOf(effect);
    shots.set(family, (shots.get(family) ?? 0) + many);
    total += many;
  }
  return [...shots.entries()]
    .map(([family, count]) => ({
      family,
      shots: count,
      share: total === 0 ? 0 : count / total,
    }))
    .sort((a, b) => b.shots - a.shots || a.family.localeCompare(b.family));
}

/**
 * Variety on a nought to one scale, using the same normalised diversity index
 * ecology uses for species counts. One means every family is equally
 * represented, nought means the whole show is one family.
 */
export function varietyIndex(entries: readonly PaletteEntry[]): number {
  const present = entries.filter((entry) => entry.shots > 0);
  if (present.length <= 1) {
    return 0;
  }
  let sum = 0;
  for (const entry of present) {
    if (entry.share > 0) {
      sum -= entry.share * Math.log(entry.share);
    }
  }
  return Number((sum / Math.log(present.length)).toFixed(4));
}

/** The families a show never reaches for, which is where a note comes from. */
export function missingFamilies(entries: readonly PaletteEntry[]): Family[] {
  const present = new Set(entries.map((entry) => entry.family));
  return (
    [
      "burst",
      "trailing",
      "ringed",
      "flashing",
      "report",
      "low",
      "ground",
    ] as const
  ).filter((family) => !present.has(family));
}

export interface PaletteLimits {
  /** A family holding more than this share is dominating. */
  readonly maxShare?: number;
  /** Below this the show is monotonous. */
  readonly minVariety?: number;
}

export function checkPalette(
  entries: readonly PaletteEntry[],
  limits: PaletteLimits = {},
): DiagnosticBag {
  const diagnostics = new DiagnosticBag();
  if (entries.length === 0) {
    return diagnostics;
  }
  const maxShare = limits.maxShare ?? 0.6;
  const minVariety = limits.minVariety ?? 0.55;

  for (const entry of entries) {
    if (entry.share > maxShare) {
      diagnostics.note({
        code: "PF1900",
        message: `${(entry.share * 100).toFixed(0)}% of the show is ${entry.family}`,
        help: "the eye stops registering the fourth of anything in a row",
      });
    }
  }
  const variety = varietyIndex(entries);
  if (variety < minVariety) {
    diagnostics.note({
      code: "PF1901",
      message: `variety reads ${variety.toFixed(2)} across ${plural(entries.length, "family", "families")}`,
    });
  }
  return diagnostics;
}

/** How the calibres are spread, which is the other half of variety. */
export function calibreSpread(
  effects: Iterable<Effect>,
  counts?: ReadonlyMap<string, number>,
): Map<string, number> {
  const shots: Effect[] = [];
  for (const effect of effects) {
    const many = counts?.get(effect.id) ?? 1;
    for (let i = 0; i < many; i += 1) {
      shots.push(effect);
    }
  }
  return countBy(shots, (effect) => {
    const size = calibreOf(effect);
    return size === undefined ? "ground" : bandOf(size);
  });
}

export function describePalette(entries: readonly PaletteEntry[]): string {
  if (entries.length === 0) {
    return "nothing to describe";
  }
  const table = renderTable(
    [
      { header: "family" },
      { header: "shots", align: "right" },
      { header: "share", align: "right" },
    ],
    entries.map((entry) => [
      entry.family,
      String(entry.shots),
      `${(entry.share * 100).toFixed(0)}%`,
    ]),
  );
  const missing = missingFamilies(entries);
  return [
    table,
    "",
    `variety ${varietyIndex(entries).toFixed(2)}`,
    missing.length === 0
      ? "every family appears"
      : `never used: ${missing.join(", ")}`,
  ].join("\n");
}

/** The families a show leans on hardest, for a one line summary. */
export function dominantFamilies(
  entries: readonly PaletteEntry[],
  howMany = 2,
): Family[] {
  const counts = new Map(
    entries.map((entry) => [entry.family, entry.shots] as const),
  );
  return rankedEntries(counts)
    .slice(0, howMany)
    .map(([family]) => family as Family);
}
