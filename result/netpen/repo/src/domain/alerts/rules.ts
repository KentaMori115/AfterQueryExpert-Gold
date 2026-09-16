/**
 * Deriving the alerts that ought to be open right now.
 *
 * The rules produce a desired set from the current state, not a stream of
 * events. Reconciling that against what is already open is a separate step,
 * which is what stops a lice breach being raised again every time somebody
 * loads the dashboard. It also keeps the rules pure: given this state, exactly
 * these alerts, which is a thing that can be tested exhaustively.
 */

import type { AlertKind, AlertSeverity, AlertSubject } from './types';
import { alertKey, DEFAULT_SEVERITY } from './types';
import { densityStatus, type LicencePosition } from '../biomass/standing';
import { levelFor } from '../health/mortality';
import type { GroupId, PenId, SiteId } from '../ids';
import { limitFor, statusFor, type Regime } from '../lice/thresholds';
import type { Instant, IsoWeek } from '../time/duration';
import { addDays } from '../time/duration';
import { isPlausibleSeaTemperature } from '../units/water';
import { oxygenBand } from '../water/oxygen';

export interface DesiredAlert {
  readonly key: string;
  readonly kind: AlertKind;
  readonly severity: AlertSeverity;
  readonly subject: AlertSubject;
  readonly message: string;
  readonly observed: number | null;
  readonly limit: number | null;
  readonly actByAt: Instant | null;
}

function want(
  kind: AlertKind,
  subject: AlertSubject,
  message: string,
  extras: Partial<Pick<DesiredAlert, 'observed' | 'limit' | 'actByAt' | 'severity'>> = {},
): DesiredAlert {
  return {
    key: alertKey(kind, subject),
    kind,
    severity: extras.severity ?? DEFAULT_SEVERITY[kind],
    subject,
    message,
    observed: extras.observed ?? null,
    limit: extras.limit ?? null,
    actByAt: extras.actByAt ?? null,
  };
}

export interface LiceRuleInput {
  readonly groupId: GroupId;
  readonly penId: PenId;
  readonly regime: Regime;
  readonly week: IsoWeek;
  readonly adultFemale: number;
  /** When the count was taken. */
  readonly countedAt: Instant;
  readonly now: Instant;
  /** Days a site may go between counts before it is overdue. */
  readonly countIntervalDays: number;
  readonly daysToAct: number;
}

export function liceAlerts(input: LiceRuleInput): DesiredAlert[] {
  const subject: AlertSubject = { type: 'group', groupId: input.groupId, penId: input.penId };
  const limit = limitFor(input.regime, input.week);
  const status = statusFor(input.regime, input.week, input.adultFemale);
  const alerts: DesiredAlert[] = [];

  if (status === 'over-limit' || status === 'enforcement') {
    alerts.push(
      want(
        'lice-over-limit',
        subject,
        `${input.adultFemale.toFixed(2)} adult female against a limit of ${limit.toFixed(1)}`,
        {
          observed: input.adultFemale,
          limit,
          actByAt: addDays(input.countedAt, input.daysToAct),
        },
      ),
    );
  } else if (status === 'approaching') {
    alerts.push(
      want(
        'lice-approaching',
        subject,
        `${input.adultFemale.toFixed(2)} adult female, book a slot`,
        {
          observed: input.adultFemale,
          limit,
        },
      ),
    );
  }

  const daysSinceCount = (input.now - input.countedAt) / 86_400_000;
  if (daysSinceCount > input.countIntervalDays) {
    alerts.push(
      want('lice-count-overdue', subject, `Last counted ${daysSinceCount.toFixed(0)} days ago`, {
        observed: daysSinceCount,
        limit: input.countIntervalDays,
      }),
    );
  }

  return alerts;
}

export interface WaterRuleInput {
  readonly penId: PenId;
  readonly siteId: SiteId;
  readonly saturationPercent: number;
  readonly temperatureC: number;
}

export function waterAlerts(input: WaterRuleInput): DesiredAlert[] {
  const subject: AlertSubject = { type: 'pen', penId: input.penId, siteId: input.siteId };
  const alerts: DesiredAlert[] = [];
  const band = oxygenBand(input.saturationPercent);

  if (band === 'critical') {
    alerts.push(
      want(
        'oxygen-critical',
        subject,
        `Saturation at ${input.saturationPercent.toFixed(0)} percent`,
        {
          observed: input.saturationPercent,
          limit: 50,
        },
      ),
    );
  } else if (band === 'low' || band === 'reduced') {
    alerts.push(
      want('oxygen-low', subject, `Saturation at ${input.saturationPercent.toFixed(0)} percent`, {
        observed: input.saturationPercent,
        limit: 70,
      }),
    );
  }

  if (!isPlausibleSeaTemperature(input.temperatureC)) {
    alerts.push(
      want('temperature-extreme', subject, `Reading of ${input.temperatureC.toFixed(1)} degrees`, {
        observed: input.temperatureC,
      }),
    );
  }

  return alerts;
}

export interface StockRuleInput {
  readonly groupId: GroupId;
  readonly penId: PenId;
  readonly dailyMortalityPercent: number | null;
  readonly densityKgM3: number;
  readonly withdrawalRemaining: number;
  readonly harvestPlanned: boolean;
}

export function stockAlerts(input: StockRuleInput): DesiredAlert[] {
  const subject: AlertSubject = { type: 'group', groupId: input.groupId, penId: input.penId };
  const alerts: DesiredAlert[] = [];

  const level = levelFor(input.dailyMortalityPercent);
  if (level === 'incident') {
    alerts.push(
      want(
        'mortality-incident',
        subject,
        `${input.dailyMortalityPercent!.toFixed(3)} percent a day`,
        {
          observed: input.dailyMortalityPercent,
        },
      ),
    );
  } else if (level === 'elevated') {
    alerts.push(
      want(
        'mortality-elevated',
        subject,
        `${input.dailyMortalityPercent!.toFixed(3)} percent a day`,
        {
          observed: input.dailyMortalityPercent,
        },
      ),
    );
  }

  if (densityStatus(input.densityKgM3) === 'over-limit') {
    alerts.push(
      want('density-over-limit', subject, `${input.densityKgM3.toFixed(1)} kg per cubic metre`, {
        observed: input.densityKgM3,
        limit: 25,
      }),
    );
  }

  if (input.harvestPlanned && input.withdrawalRemaining > 0) {
    alerts.push(
      want(
        'withdrawal-blocking-harvest',
        subject,
        `${input.withdrawalRemaining.toFixed(0)} degree-days still to run`,
        { observed: input.withdrawalRemaining },
      ),
    );
  }

  return alerts;
}

export interface SiteRuleInput {
  readonly siteId: SiteId;
  readonly licence: LicencePosition;
  /** Fraction of the licence at which the site starts planning a harvest. */
  readonly nearFraction: number;
}

export function siteAlerts(input: SiteRuleInput): DesiredAlert[] {
  const subject: AlertSubject = { type: 'site', siteId: input.siteId };

  if (input.licence.overLimit) {
    return [
      want(
        'biomass-over-licence',
        subject,
        `${input.licence.standingT.toFixed(0)} t against a licence of ${input.licence.limitT} t`,
        { observed: input.licence.standingT, limit: input.licence.limitT },
      ),
    ];
  }

  if (input.licence.utilisation >= input.nearFraction) {
    return [
      want(
        'biomass-near-licence',
        subject,
        `${(input.licence.utilisation * 100).toFixed(0)} percent of the licence used`,
        { observed: input.licence.standingT, limit: input.licence.limitT },
      ),
    ];
  }

  return [];
}

/** Collapse several rule outputs into one keyed set, first writer winning. */
export function merge(groups: readonly (readonly DesiredAlert[])[]): DesiredAlert[] {
  const byKey = new Map<string, DesiredAlert>();
  for (const group of groups) {
    for (const alert of group) {
      if (!byKey.has(alert.key)) byKey.set(alert.key, alert);
    }
  }
  return [...byKey.values()];
}
