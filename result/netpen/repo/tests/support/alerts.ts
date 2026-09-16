/**
 * Synthetic alerts.
 *
 * Alerts are produced by the rules module from a whole dataset, which is the
 * wrong end to build one from when the test is about how a row is drawn. This
 * builds them directly, defaulting to an open, unacknowledged, urgent lice
 * alert, since that is the row every other case is a variation on.
 */

import type { Alert, AlertKind, AlertSeverity } from '@/domain/alerts/types';
import { DEFAULT_SEVERITY } from '@/domain/alerts/types';

import { TEST_NOW } from './penView';

export interface AlertOptions {
  readonly id?: string;
  readonly kind?: AlertKind;
  readonly severity?: AlertSeverity;
  readonly penNumber?: number | null;
  readonly raisedAt?: number;
  readonly clearedAt?: number | null;
  readonly acknowledgedAt?: number | null;
  readonly acknowledgedBy?: string | null;
  readonly message?: string;
  readonly observed?: number | null;
  readonly limit?: number | null;
  readonly actByAt?: number | null;
}

export function alert(options: AlertOptions = {}): Alert {
  const kind = options.kind ?? 'lice-over-limit';
  const penNumber = options.penNumber === undefined ? 3 : options.penNumber;

  return {
    id: options.id ?? `alert-${kind}-${penNumber ?? 'site'}`,
    kind,
    severity: options.severity ?? DEFAULT_SEVERITY[kind],
    subject:
      penNumber === null
        ? { type: 'site', siteId: 'site-1' }
        : { type: 'pen', penId: `pen-${penNumber}`, siteId: 'site-1' },
    raisedAt: options.raisedAt ?? TEST_NOW - 3 * 86_400_000,
    clearedAt: options.clearedAt ?? null,
    acknowledgedAt: options.acknowledgedAt ?? null,
    acknowledgedBy: options.acknowledgedBy ?? null,
    message: options.message ?? 'Adult female lice at 0.62 against a limit of 0.50.',
    observed: options.observed === undefined ? 0.62 : options.observed,
    limit: options.limit === undefined ? 0.5 : options.limit,
    actByAt: options.actByAt ?? null,
  } as unknown as Alert;
}
