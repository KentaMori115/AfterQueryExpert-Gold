/**
 * Mass, at three scales that never get mixed up on a site.
 *
 * An individual fish is weighed in grams, a pen holds tonnes, and everything
 * in between is kilogrammes. The three appear side by side constantly - a pen
 * of 180 thousand fish at 2 340 g is 421 tonnes - and the commonest arithmetic
 * mistake on a stock sheet is a factor of a thousand in one direction or the
 * other.
 *
 * Everything here is stored in grams. Grams because that is the unit of the
 * smallest thing measured, so nothing below the storage unit ever has to be a
 * fraction, and a biomass in grams still fits comfortably in a double: a whole
 * site at licence is on the order of 5e12 g, and the safe integer range is
 * 9e15.
 */

export type MassUnit = 'g' | 'kg' | 't';

const GRAMS_PER: Record<MassUnit, number> = {
  g: 1,
  kg: 1_000,
  t: 1_000_000,
};

/** Digits each unit is conventionally written to on a stock sheet. */
export const MASS_DIGITS: Record<MassUnit, number> = {
  g: 0,
  kg: 1,
  t: 1,
};

export function toGrams(value: number, from: MassUnit): number {
  return value * GRAMS_PER[from];
}

export function fromGrams(grams: number, to: MassUnit): number {
  return grams / GRAMS_PER[to];
}

export function convertMass(value: number, from: MassUnit, to: MassUnit): number {
  if (from === to) return value;
  return fromGrams(toGrams(value, from), to);
}

/**
 * The unit a mass should be written in, chosen by magnitude the way a person
 * would: a single fish in grams, a mort box in kilogrammes, a pen in tonnes.
 */
export function naturalUnit(grams: number): MassUnit {
  const magnitude = Math.abs(grams);
  if (magnitude >= 500_000) return 't';
  if (magnitude >= 1_000) return 'kg';
  return 'g';
}

export function formatMass(grams: number | null | undefined, unit?: MassUnit): string {
  if (grams === null || grams === undefined || !Number.isFinite(grams)) return '—';
  const chosen = unit ?? naturalUnit(grams);
  return `${fromGrams(grams, chosen).toFixed(MASS_DIGITS[chosen])} ${chosen}`;
}

/**
 * Standing biomass from a count and a mean weight.
 *
 * Deliberately takes the count first, because that is the order it is written
 * in every stock record, and a signature that reverses the domain's own
 * convention is a signature people call wrongly.
 */
export function biomassGrams(count: number, meanWeightGrams: number): number {
  if (count < 0) {
    throw new RangeError('A pen cannot hold a negative number of fish');
  }
  if (meanWeightGrams < 0) {
    throw new RangeError('Mean weight cannot be negative');
  }
  return count * meanWeightGrams;
}

/** Mean weight implied by a biomass and a count. Null for an empty pen. */
export function meanWeightGrams(biomassG: number, count: number): number | null {
  if (count <= 0) return null;
  return biomassG / count;
}

/**
 * Plausibility band for a farmed Atlantic salmon, smolt through harvest.
 * Anything outside is a transcription error rather than a fish.
 */
export const SMOLT_MIN_GRAMS = 40;
export const HARVEST_MAX_GRAMS = 12_000;

export function isPlausibleFishWeight(grams: number): boolean {
  return Number.isFinite(grams) && grams >= SMOLT_MIN_GRAMS && grams <= HARVEST_MAX_GRAMS;
}
