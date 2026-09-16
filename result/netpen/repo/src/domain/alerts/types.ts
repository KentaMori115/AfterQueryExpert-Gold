/**
 * Alerts.
 *
 * The failure mode of a monitoring system on a farm is not missing something.
 * It is raising the same thing every fifteen minutes until the crew stop
 * looking, and then missing something. So an alert here has an identity taken
 * from what it is about rather than from when it fired: it opens once, stays
 * open while the condition holds, and clears itself when the condition goes.
 *
 * Severity is about consequence, not size. A lice count over the limit is
 * severe because it carries a legal obligation with a deadline. Oxygen at
 * fifty percent is severe because fish die within hours. A net coming due for
 * change is not severe at all, it is just something that has to be booked.
 */

import type { AlertId, GroupId, PenId, SiteId } from '../ids';
import type { Instant } from '../time/duration';

export type AlertKind =
  | 'lice-over-limit'
  | 'lice-approaching'
  | 'lice-count-overdue'
  | 'oxygen-critical'
  | 'oxygen-low'
  | 'mortality-incident'
  | 'mortality-elevated'
  | 'biomass-over-licence'
  | 'biomass-near-licence'
  | 'density-over-limit'
  | 'withdrawal-blocking-harvest'
  | 'net-due-for-change'
  | 'temperature-extreme';

export type AlertSeverity = 'info' | 'warning' | 'urgent';

export type AlertSubject =
  | { readonly type: 'site'; readonly siteId: SiteId }
  | { readonly type: 'pen'; readonly penId: PenId; readonly siteId: SiteId }
  | { readonly type: 'group'; readonly groupId: GroupId; readonly penId: PenId };

export interface Alert {
  readonly id: AlertId;
  readonly kind: AlertKind;
  readonly severity: AlertSeverity;
  readonly subject: AlertSubject;
  readonly raisedAt: Instant;
  readonly clearedAt: Instant | null;
  readonly acknowledgedAt: Instant | null;
  readonly acknowledgedBy: string | null;
  readonly message: string;
  readonly observed: number | null;
  readonly limit: number | null;
  /** Deadline where the alert carries a legal one, as lice counts do. */
  readonly actByAt: Instant | null;
}

export const ALERT_LABELS: Record<AlertKind, string> = {
  'lice-over-limit': 'Lice over the limit',
  'lice-approaching': 'Lice approaching the limit',
  'lice-count-overdue': 'Lice count overdue',
  'oxygen-critical': 'Oxygen critical',
  'oxygen-low': 'Oxygen low',
  'mortality-incident': 'Mortality at incident level',
  'mortality-elevated': 'Mortality elevated',
  'biomass-over-licence': 'Biomass over the licence',
  'biomass-near-licence': 'Biomass approaching the licence',
  'density-over-limit': 'Density over the limit',
  'withdrawal-blocking-harvest': 'Withdrawal period blocking harvest',
  'net-due-for-change': 'Net due for change',
  'temperature-extreme': 'Temperature outside the working range',
};

export const DEFAULT_SEVERITY: Record<AlertKind, AlertSeverity> = {
  'lice-over-limit': 'urgent',
  'lice-approaching': 'warning',
  'lice-count-overdue': 'warning',
  'oxygen-critical': 'urgent',
  'oxygen-low': 'warning',
  'mortality-incident': 'urgent',
  'mortality-elevated': 'warning',
  'biomass-over-licence': 'urgent',
  'biomass-near-licence': 'warning',
  'density-over-limit': 'warning',
  'withdrawal-blocking-harvest': 'warning',
  'net-due-for-change': 'info',
  'temperature-extreme': 'info',
};

/**
 * Alerts that carry an obligation to somebody outside the company. These are
 * the ones that cannot simply be acknowledged and left.
 */
export const REGULATORY_KINDS: readonly AlertKind[] = [
  'lice-over-limit',
  'lice-count-overdue',
  'biomass-over-licence',
  'density-over-limit',
];

export function isRegulatory(kind: AlertKind): boolean {
  return REGULATORY_KINDS.includes(kind);
}

/** Stable identity. The same condition produces the same key every time. */
export function alertKey(kind: AlertKind, subject: AlertSubject): string {
  switch (subject.type) {
    case 'site':
      return `${kind}:site:${subject.siteId}`;
    case 'pen':
      return `${kind}:pen:${subject.penId}`;
    case 'group':
      return `${kind}:group:${subject.groupId}`;
  }
}

export function isOpen(alert: Alert): boolean {
  return alert.clearedAt === null;
}

export function isAcknowledged(alert: Alert): boolean {
  return alert.acknowledgedAt !== null;
}

export function needsAttention(alert: Alert): boolean {
  return isOpen(alert) && !isAcknowledged(alert);
}

export const SEVERITY_RANK: Record<AlertSeverity, number> = {
  urgent: 0,
  warning: 1,
  info: 2,
};

/**
 * Urgent first, then anything with a deadline, then most recent. The deadline
 * ranks above recency because a lice obligation running out on Friday matters
 * more than something that started an hour ago.
 */
export function byUrgency(a: Alert, b: Alert): number {
  const rank = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
  if (rank !== 0) return rank;

  if (a.actByAt !== null && b.actByAt !== null && a.actByAt !== b.actByAt) {
    return a.actByAt - b.actByAt;
  }
  if (a.actByAt !== null && b.actByAt === null) return -1;
  if (a.actByAt === null && b.actByAt !== null) return 1;

  return b.raisedAt - a.raisedAt;
}
