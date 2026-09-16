/**
 * Standing biomass, density and the licence.
 *
 * A site is licensed for a maximum allowed biomass in tonnes, and that ceiling
 * is the hardest constraint in the whole operation. It is not a target to be
 * approached carefully; exceeding it is a breach whether or not anybody
 * noticed, and the fish keep growing whether or not there is a harvest slot
 * available. Almost every difficult decision on a site is really about getting
 * fish off before the ceiling arrives.
 *
 * Density is the other limit and it bites per pen rather than per site. A pen
 * that is inside the site licence can still be over the density limit if the
 * stock has been consolidated into fewer pens, which is exactly what happens
 * after a mortality event or during a treatment.
 */

import { biomassGrams } from '../units/mass';

/** Circular pens, quoted by the circumference of the collar in metres. */
export const STANDARD_CIRCUMFERENCES_M = [90, 120, 157, 200] as const;

export interface PenGeometry {
  /** Circumference of the collar, metres. */
  readonly circumferenceM: number;
  /** Depth of the net wall, metres. */
  readonly depthM: number;
}

export function penRadiusM(geometry: PenGeometry): number {
  if (geometry.circumferenceM <= 0) {
    throw new RangeError('A pen needs a positive circumference');
  }
  return geometry.circumferenceM / (2 * Math.PI);
}

export function penSurfaceM2(geometry: PenGeometry): number {
  return Math.PI * penRadiusM(geometry) ** 2;
}

/**
 * Cylindrical volume. Real nets take a conical or hemispherical bottom and
 * hold rather less, but the licensed density is defined against the nominal
 * cylinder, so that is what compliance is measured on.
 */
export function penVolumeM3(geometry: PenGeometry): number {
  if (geometry.depthM <= 0) {
    throw new RangeError('A pen needs a positive depth');
  }
  return penSurfaceM2(geometry) * geometry.depthM;
}

export interface PenStock {
  readonly penId: string;
  readonly count: number;
  readonly meanWeightG: number;
  readonly geometry: PenGeometry;
}

export function penBiomassKg(stock: PenStock): number {
  return biomassGrams(stock.count, stock.meanWeightG) / 1_000;
}

export function penDensityKgM3(stock: PenStock): number {
  return penBiomassKg(stock) / penVolumeM3(stock.geometry);
}

/** The density ceiling a marine grow-out licence sets. */
export const DENSITY_LIMIT_KG_M3 = 25;
/** Where a site starts moving fish rather than waiting. */
export const DENSITY_WATCH_KG_M3 = 22;

export type DensityStatus = 'comfortable' | 'watch' | 'over-limit';

export function densityStatus(densityKgM3: number): DensityStatus {
  if (densityKgM3 > DENSITY_LIMIT_KG_M3) return 'over-limit';
  if (densityKgM3 >= DENSITY_WATCH_KG_M3) return 'watch';
  return 'comfortable';
}

export const DENSITY_LABELS: Record<DensityStatus, string> = {
  comfortable: 'Inside the density limit',
  watch: 'Approaching the density limit',
  'over-limit': 'Over the density limit',
};

/** Fish the pen could still take at the limit, at the current mean weight. */
export function headroomFish(stock: PenStock): number {
  const capacityKg = penVolumeM3(stock.geometry) * DENSITY_LIMIT_KG_M3;
  const spareKg = capacityKg - penBiomassKg(stock);
  if (spareKg <= 0 || stock.meanWeightG <= 0) return 0;
  return Math.floor((spareKg * 1_000) / stock.meanWeightG);
}

export interface SiteLicence {
  readonly siteId: string;
  /** Maximum allowed biomass, tonnes. */
  readonly maxBiomassT: number;
}

export interface LicencePosition {
  readonly standingT: number;
  readonly limitT: number;
  readonly headroomT: number;
  readonly utilisation: number;
  readonly overLimit: boolean;
}

export function licencePosition(pens: readonly PenStock[], licence: SiteLicence): LicencePosition {
  const standingT = pens.reduce((total, pen) => total + penBiomassKg(pen), 0) / 1_000;
  const headroomT = licence.maxBiomassT - standingT;

  return {
    standingT,
    limitT: licence.maxBiomassT,
    headroomT,
    utilisation: licence.maxBiomassT > 0 ? standingT / licence.maxBiomassT : 0,
    overLimit: standingT > licence.maxBiomassT,
  };
}

/**
 * The week the ceiling arrives, given a projected site biomass by week. The
 * whole harvest plan is built backwards from this number, so it returns the
 * index rather than a date and lets the caller decide what a week means.
 */
export function weekOfBreach(
  projectedBiomassT: readonly number[],
  licence: SiteLicence,
): number | null {
  for (let index = 0; index < projectedBiomassT.length; index += 1) {
    if (projectedBiomassT[index]! > licence.maxBiomassT) return index;
  }
  return null;
}

/**
 * Tonnes that must come off by a given week to stay inside the licence. Zero
 * where the projection is already inside it.
 */
export function harvestRequiredT(
  projectedBiomassT: readonly number[],
  licence: SiteLicence,
): number[] {
  return projectedBiomassT.map((biomass) => {
    const excess = biomass - licence.maxBiomassT;
    return excess > 0 ? excess : 0;
  });
}

export function formatTonnes(tonnes: number | null): string {
  if (tonnes === null || !Number.isFinite(tonnes)) return '—';
  return `${tonnes.toFixed(1)} t`;
}

export function formatDensity(kgM3: number | null): string {
  if (kgM3 === null || !Number.isFinite(kgM3)) return '—';
  return `${kgM3.toFixed(1)} kg/m³`;
}
