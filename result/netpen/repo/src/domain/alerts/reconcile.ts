/**
 * Reconciling what should be open against what is.
 *
 *   wanted, not open      raise it
 *   wanted and open       leave it, unless it got worse
 *   open, not wanted      clear it
 *
 * "Unless it got worse" is the only piece of nuance and it earns its place. A
 * lice alert that goes from approaching to over the limit has to become
 * visible again even if somebody acknowledged it yesterday, because the
 * obligation attached to it has changed. It stays the same alert, so the
 * history reads as one excursion rather than two, and the acknowledgement is
 * dropped so it comes back to the top of the list.
 */

import type { AlertId } from '../ids';
import { alertId as makeAlertId } from '../ids';
import type { DesiredAlert } from './rules';
import type { Alert } from './types';
import { alertKey, isOpen, SEVERITY_RANK } from './types';
import type { Instant } from '../time/duration';

export interface Reconciliation {
  readonly raised: readonly Alert[];
  readonly escalated: readonly Alert[];
  readonly cleared: readonly Alert[];
  readonly unchanged: readonly Alert[];
  /** Everything to persist after this pass. */
  readonly next: readonly Alert[];
}

export interface ReconcileOptions {
  readonly now: Instant;
  readonly nextId: (key: string) => AlertId;
}

/** Sequential id factory, so two alerts raised in the same pass sort stably. */
export function idFactory(prefix = 'alr'): (key: string) => AlertId {
  let sequence = 0;
  return () => {
    sequence += 1;
    return makeAlertId(`${prefix}-${String(sequence).padStart(5, '0')}`);
  };
}

function keyOf(alert: Alert): string {
  return alertKey(alert.kind, alert.subject);
}

export function reconcile(
  existing: readonly Alert[],
  desired: readonly DesiredAlert[],
  options: ReconcileOptions,
): Reconciliation {
  const openByKey = new Map<string, Alert>();
  for (const alert of existing) {
    if (isOpen(alert)) openByKey.set(keyOf(alert), alert);
  }

  const wantedKeys = new Set(desired.map((entry) => entry.key));

  const raised: Alert[] = [];
  const escalated: Alert[] = [];
  const cleared: Alert[] = [];
  const unchanged: Alert[] = [];

  for (const entry of desired) {
    const current = openByKey.get(entry.key);

    if (!current) {
      raised.push({
        id: options.nextId(entry.key),
        kind: entry.kind,
        severity: entry.severity,
        subject: entry.subject,
        raisedAt: options.now,
        clearedAt: null,
        acknowledgedAt: null,
        acknowledgedBy: null,
        message: entry.message,
        observed: entry.observed,
        limit: entry.limit,
        actByAt: entry.actByAt,
      });
      continue;
    }

    if (SEVERITY_RANK[entry.severity] < SEVERITY_RANK[current.severity]) {
      escalated.push({
        ...current,
        severity: entry.severity,
        message: entry.message,
        observed: entry.observed,
        limit: entry.limit,
        actByAt: entry.actByAt,
        acknowledgedAt: null,
        acknowledgedBy: null,
      });
    } else {
      unchanged.push({
        ...current,
        message: entry.message,
        observed: entry.observed,
        actByAt: entry.actByAt ?? current.actByAt,
      });
    }
  }

  for (const [key, alert] of openByKey) {
    if (!wantedKeys.has(key)) cleared.push({ ...alert, clearedAt: options.now });
  }

  // Everything produced above came out of openByKey, so what is left to carry
  // forward is exactly the alerts that were already closed. Keeping them is
  // what makes a recurring condition readable as a history rather than as a
  // single event that keeps reappearing.
  const closed = existing.filter((alert) => !isOpen(alert));

  return {
    raised,
    escalated,
    cleared,
    unchanged,
    next: [...closed, ...cleared, ...unchanged, ...escalated, ...raised],
  };
}

export function acknowledge(alert: Alert, by: string, at: Instant): Alert {
  if (!isOpen(alert)) return alert;
  return { ...alert, acknowledgedAt: at, acknowledgedBy: by };
}

export function clear(alert: Alert, at: Instant): Alert {
  return isOpen(alert) ? { ...alert, clearedAt: at } : alert;
}

/** How long an alert stood open, in hours. Null while it is still open. */
export function openHours(alert: Alert): number | null {
  return alert.clearedAt === null ? null : (alert.clearedAt - alert.raisedAt) / 3_600_000;
}

export interface AlertSummary {
  readonly open: number;
  readonly unacknowledged: number;
  readonly urgent: number;
  readonly regulatory: number;
  readonly worst: Alert['severity'] | null;
}

export function summarise(alerts: readonly Alert[]): AlertSummary {
  let open = 0;
  let unacknowledged = 0;
  let urgent = 0;
  let warning = 0;

  for (const alert of alerts) {
    if (!isOpen(alert)) continue;
    open += 1;
    if (alert.acknowledgedAt === null) unacknowledged += 1;
    if (alert.severity === 'urgent') urgent += 1;
    else if (alert.severity === 'warning') warning += 1;
  }

  return {
    open,
    unacknowledged,
    urgent,
    regulatory: alerts.filter((alert) => isOpen(alert) && alert.actByAt !== null).length,
    worst: open === 0 ? null : urgent > 0 ? 'urgent' : warning > 0 ? 'warning' : 'info',
  };
}
