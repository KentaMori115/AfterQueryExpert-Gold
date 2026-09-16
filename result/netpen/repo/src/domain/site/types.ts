/**
 * The site and its pens.
 *
 * A site is a licence, a position and a ring of pens. The licence is the part
 * that matters most: it fixes the maximum allowed biomass, it names which
 * regulatory regime the lice limits come from, and it carries the fallowing
 * obligation that decides when the next generation can go in.
 *
 * Pens are numbered rather than named, and the numbering is physical: pen 3 is
 * the third one along the mooring grid and stays pen 3 for the life of the
 * site. Groups of fish come and go through it.
 */

import type { PenGeometry } from '../biomass/standing';
import type { PenId, PersonId, SiteId } from '../ids';
import type { Regime } from '../lice/thresholds';
import type { Instant } from '../time/duration';

export type SiteStatus = 'stocked' | 'harvesting' | 'fallow' | 'mothballed';

export interface Position {
  readonly latitude: number;
  readonly longitude: number;
}

export interface Site {
  readonly id: SiteId;
  /** Licence reference, which is what the regulator calls it. */
  readonly code: string;
  readonly name: string;
  readonly operator: string;
  readonly regime: Regime;
  readonly position: Position;
  /** Maximum allowed biomass, tonnes. */
  readonly maxBiomassT: number;
  /** Weeks the site must lie empty between generations. */
  readonly fallowWeeks: number;
  readonly status: SiteStatus;
  readonly manager: PersonId | null;
  /** Depth under the pens at chart datum, metres. */
  readonly depthM: number;
  readonly notes: string;
}

export type PenStatus = 'stocked' | 'empty' | 'maintenance' | 'withdrawn';

export interface Pen {
  readonly id: PenId;
  readonly siteId: SiteId;
  /** Physical position on the grid, and what everyone calls it. */
  readonly number: number;
  readonly geometry: PenGeometry;
  readonly status: PenStatus;
  /** Net installed date, which drives the antifoul and inspection cycle. */
  readonly netInstalledAt: Instant | null;
  readonly notes: string;
}

export const PEN_STATUS_LABELS: Record<PenStatus, string> = {
  stocked: 'Stocked',
  empty: 'Empty',
  maintenance: 'Under maintenance',
  withdrawn: 'Withdrawn from use',
};

export const SITE_STATUS_LABELS: Record<SiteStatus, string> = {
  stocked: 'Stocked',
  harvesting: 'Harvesting',
  fallow: 'Fallow',
  mothballed: 'Mothballed',
};

export function isUsable(pen: Pen): boolean {
  return pen.status === 'stocked' || pen.status === 'empty';
}

/** Pens in the order they sit on the grid, which is how the barge reads them. */
export function byPenNumber(a: Pen, b: Pen): number {
  return a.number - b.number;
}

/**
 * Nets are changed on a cycle; a net past its service life is both a biofoul
 * problem and an escape risk, and the inspection regime hangs off this date.
 */
export const NET_SERVICE_WEEKS = 104;

export function netAgeWeeks(pen: Pen, at: Instant): number | null {
  if (pen.netInstalledAt === null) return null;
  return Math.floor((at - pen.netInstalledAt) / 604_800_000);
}

export function netDueForChange(pen: Pen, at: Instant): boolean {
  const age = netAgeWeeks(pen, at);
  return age !== null && age >= NET_SERVICE_WEEKS;
}

/** Total nominal volume across the pens that can hold fish. */
export function siteVolumeM3(pens: readonly Pen[]): number {
  return pens
    .filter(isUsable)
    .reduce(
      (total, pen) =>
        total + Math.PI * (pen.geometry.circumferenceM / (2 * Math.PI)) ** 2 * pen.geometry.depthM,
      0,
    );
}

/** Distance in nautical miles between two positions, on a spherical earth. */
export function distanceNm(from: Position, to: Position): number {
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const earthRadiusNm = 3_440.065;

  const dLat = toRadians(to.latitude - from.latitude);
  const dLon = toRadians(to.longitude - from.longitude);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(from.latitude)) * Math.cos(toRadians(to.latitude)) * Math.sin(dLon / 2) ** 2;

  return 2 * earthRadiusNm * Math.asin(Math.sqrt(a));
}
