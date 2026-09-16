/**
 * Lice treatments and what they cost.
 *
 * Every method on the list works and every one of them has a price attached
 * that is not the invoice. Medicines carry a withdrawal period before the fish
 * can be sold, counted in degree-days rather than days, so a treatment in a
 * cold February holds a harvest slot far longer than the same treatment in
 * August. Mechanical methods carry no withdrawal at all but take a bite out of
 * growth and put fish through a pump, and the mortality that follows is real
 * and shows up over the fortnight after rather than on the day.
 *
 * The interesting decision is almost never "does this work". It is "what does
 * this cost me against the harvest slot I have already sold", and that is what
 * this module is for.
 */

import { accumulate, type TemperatureSample } from '../time/degreeDays';
import type { Instant } from '../time/duration';

export type TreatmentMethod =
  | 'emamectin-benzoate'
  | 'teflubenzuron'
  | 'azamethiphos'
  | 'hydrogen-peroxide'
  | 'deltamethrin'
  | 'thermal'
  | 'freshwater'
  | 'mechanical-brush'
  | 'cleaner-fish';

export type TreatmentKind = 'in-feed' | 'bath' | 'non-medicinal' | 'biological';

export interface TreatmentProfile {
  readonly method: TreatmentMethod;
  readonly kind: TreatmentKind;
  readonly label: string;
  /** Degree-days that must pass before the fish may be harvested. */
  readonly withdrawalDegreeDays: number;
  /** Typical reduction in adult females, as a fraction. */
  readonly typicalEfficacy: number;
  /** Extra mortality over the fortnight after, as a fraction of the pen. */
  readonly typicalMortality: number;
  /** Whether the fish are crowded and pumped, which is what costs growth. */
  readonly handles: boolean;
}

export const TREATMENTS: readonly TreatmentProfile[] = [
  {
    method: 'emamectin-benzoate',
    kind: 'in-feed',
    label: 'Emamectin benzoate in feed',
    withdrawalDegreeDays: 175,
    typicalEfficacy: 0.75,
    typicalMortality: 0.001,
    handles: false,
  },
  {
    method: 'teflubenzuron',
    kind: 'in-feed',
    label: 'Teflubenzuron in feed',
    withdrawalDegreeDays: 105,
    typicalEfficacy: 0.7,
    typicalMortality: 0.001,
    handles: false,
  },
  {
    method: 'azamethiphos',
    kind: 'bath',
    label: 'Azamethiphos bath',
    withdrawalDegreeDays: 0,
    typicalEfficacy: 0.72,
    typicalMortality: 0.004,
    handles: true,
  },
  {
    method: 'hydrogen-peroxide',
    kind: 'bath',
    label: 'Hydrogen peroxide bath',
    withdrawalDegreeDays: 0,
    typicalEfficacy: 0.68,
    typicalMortality: 0.006,
    handles: true,
  },
  {
    method: 'deltamethrin',
    kind: 'bath',
    label: 'Deltamethrin bath',
    withdrawalDegreeDays: 0,
    typicalEfficacy: 0.65,
    typicalMortality: 0.004,
    handles: true,
  },
  {
    method: 'thermal',
    kind: 'non-medicinal',
    label: 'Thermal delousing',
    withdrawalDegreeDays: 0,
    typicalEfficacy: 0.88,
    typicalMortality: 0.012,
    handles: true,
  },
  {
    method: 'freshwater',
    kind: 'non-medicinal',
    label: 'Freshwater bath',
    withdrawalDegreeDays: 0,
    typicalEfficacy: 0.8,
    typicalMortality: 0.007,
    handles: true,
  },
  {
    method: 'mechanical-brush',
    kind: 'non-medicinal',
    label: 'Mechanical brushing',
    withdrawalDegreeDays: 0,
    typicalEfficacy: 0.82,
    typicalMortality: 0.009,
    handles: true,
  },
  {
    method: 'cleaner-fish',
    kind: 'biological',
    label: 'Cleaner fish',
    withdrawalDegreeDays: 0,
    typicalEfficacy: 0.35,
    typicalMortality: 0,
    handles: false,
  },
];

const BY_METHOD = new Map(TREATMENTS.map((profile) => [profile.method, profile]));

export function profileFor(method: TreatmentMethod): TreatmentProfile {
  const profile = BY_METHOD.get(method);
  if (!profile) {
    throw new RangeError(`No treatment profile for ${method}`);
  }
  return profile;
}

export function isMedicinal(method: TreatmentMethod): boolean {
  const kind = profileFor(method).kind;
  return kind === 'in-feed' || kind === 'bath';
}

export interface TreatmentEvent {
  readonly id: string;
  readonly method: TreatmentMethod;
  /** When dosing finished, which is when the withdrawal clock starts. */
  readonly completedAt: Instant;
  readonly penId: string;
  /** Adult females before and after, where a count was taken. */
  readonly beforeCount: number | null;
  readonly afterCount: number | null;
  readonly note: string;
}

/** Reduction actually achieved, as a fraction. Null without both counts. */
export function achievedEfficacy(event: TreatmentEvent): number | null {
  if (event.beforeCount === null || event.afterCount === null) return null;
  if (event.beforeCount <= 0) return null;
  const reduction = (event.beforeCount - event.afterCount) / event.beforeCount;
  return reduction > 0 ? reduction : 0;
}

export interface WithdrawalStatus {
  readonly required: number;
  readonly accumulated: number;
  readonly remaining: number;
  readonly cleared: boolean;
}

/**
 * Where a pen stands against the withdrawal on its last medicinal treatment.
 * Non-medicinal methods return a cleared status rather than null, because the
 * caller wants to show a row either way and a null would make every screen
 * write the same conditional.
 */
export function withdrawalStatus(
  event: TreatmentEvent,
  samplesSince: readonly TemperatureSample[],
): WithdrawalStatus {
  const required = profileFor(event.method).withdrawalDegreeDays;
  const accumulated = accumulate(samplesSince.filter((sample) => sample.at >= event.completedAt));
  const remaining = required - accumulated;

  return {
    required,
    accumulated,
    remaining: remaining > 0 ? remaining : 0,
    cleared: remaining <= 0,
  };
}

/**
 * The treatment holding a pen back, which is the most recent medicinal one
 * that has not yet cleared. Non-medicinal treatments never hold a pen.
 */
export function blockingTreatment(
  events: readonly TreatmentEvent[],
  samples: readonly TemperatureSample[],
): TreatmentEvent | null {
  const medicinal = events
    .filter((event) => isMedicinal(event.method))
    .sort((a, b) => b.completedAt - a.completedAt);

  for (const event of medicinal) {
    if (!withdrawalStatus(event, samples).cleared) return event;
  }
  return null;
}

/**
 * Lice left after a treatment at its typical efficacy. Used for the projection
 * on the treatment planning screen, where the point is to compare methods
 * before one has been chosen.
 */
export function projectedAfter(beforeCount: number, method: TreatmentMethod): number {
  return beforeCount * (1 - profileFor(method).typicalEfficacy);
}

/** Fish expected to be lost to a treatment, from the pen's standing count. */
export function projectedMortality(standingCount: number, method: TreatmentMethod): number {
  return Math.round(standingCount * profileFor(method).typicalMortality);
}

export function formatEfficacy(fraction: number | null): string {
  if (fraction === null || !Number.isFinite(fraction)) return '—';
  return `${(fraction * 100).toFixed(0)} %`;
}
