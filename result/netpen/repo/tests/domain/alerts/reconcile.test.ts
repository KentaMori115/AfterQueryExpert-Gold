import { describe, expect, it } from 'vitest';

import {
  acknowledge,
  clear,
  idFactory,
  openHours,
  reconcile,
  summarise,
} from '@/domain/alerts/reconcile';
import type { DesiredAlert } from '@/domain/alerts/rules';
import type { Alert, AlertKind, AlertSeverity } from '@/domain/alerts/types';
import { alertKey, needsAttention } from '@/domain/alerts/types';
import { alertId, siteId } from '@/domain/ids';
import { addDays, parseInstant } from '@/domain/time/duration';

const site = siteId('site-1');
const subject = { type: 'site', siteId: site } as const;
const t0 = parseInstant('2025-05-10T06:00:00Z');
const t1 = addDays(t0, 1);

const options = () => ({ now: t1, nextId: idFactory() });

function wanted(
  kind: AlertKind,
  severity: AlertSeverity = 'warning',
  message = 'condition holds',
): DesiredAlert {
  return {
    key: alertKey(kind, subject),
    kind,
    severity,
    subject,
    message,
    observed: 0.4,
    limit: 0.5,
    actByAt: null,
  };
}

function open(kind: AlertKind, severity: AlertSeverity = 'warning'): Alert {
  return {
    id: alertId(`alr-${kind}`),
    kind,
    severity,
    subject,
    raisedAt: t0,
    clearedAt: null,
    acknowledgedAt: null,
    acknowledgedBy: null,
    message: 'condition holds',
    observed: 0.4,
    limit: 0.5,
    actByAt: null,
  };
}

describe('raising', () => {
  it('raises something wanted that is not open', () => {
    const result = reconcile([], [wanted('lice-approaching')], options());
    expect(result.raised).toHaveLength(1);
    expect(result.raised[0]?.raisedAt).toBe(t1);
    expect(result.next).toHaveLength(1);
  });

  it('does not raise a second copy while the first stands', () => {
    const existing = [open('lice-approaching')];
    const result = reconcile(existing, [wanted('lice-approaching')], options());
    expect(result.raised).toEqual([]);
    expect(result.unchanged[0]?.id).toBe(existing[0]?.id);
    expect(result.unchanged[0]?.raisedAt).toBe(t0);
  });

  it('raises again once the previous one was cleared', () => {
    const closed = { ...open('lice-approaching'), clearedAt: addDays(t0, 0.5) };
    const result = reconcile([closed], [wanted('lice-approaching')], options());
    expect(result.raised).toHaveLength(1);
    expect(result.next).toHaveLength(2);
  });
});

describe('clearing', () => {
  it('clears an open alert nobody wants any more', () => {
    const result = reconcile([open('oxygen-low')], [], options());
    expect(result.cleared).toHaveLength(1);
    expect(result.cleared[0]?.clearedAt).toBe(t1);
  });

  it('leaves an already cleared alert alone', () => {
    const closed = { ...open('oxygen-low'), clearedAt: t0 };
    const result = reconcile([closed], [], options());
    expect(result.cleared).toEqual([]);
    expect(result.next).toEqual([closed]);
  });
});

describe('escalation', () => {
  it('raises severity in place and drops the acknowledgement', () => {
    const acknowledged = {
      ...open('lice-approaching', 'warning'),
      acknowledgedAt: addDays(t0, 0.2),
      acknowledgedBy: 'per-tait',
    };
    const result = reconcile(
      [acknowledged],
      [wanted('lice-approaching', 'urgent', 'now over the limit')],
      options(),
    );

    const escalated = result.escalated[0]!;
    expect(result.escalated).toHaveLength(1);
    expect(escalated.id).toBe(acknowledged.id);
    expect(escalated.severity).toBe('urgent');
    expect(escalated.acknowledgedAt).toBeNull();
    expect(escalated.raisedAt).toBe(t0);
    expect(escalated.message).toBe('now over the limit');
  });

  it('does not de-escalate an alert that improves', () => {
    const urgent = open('lice-over-limit', 'urgent');
    const result = reconcile([urgent], [wanted('lice-over-limit', 'warning')], options());
    expect(result.escalated).toEqual([]);
    expect(result.unchanged[0]?.severity).toBe('urgent');
  });

  it('keeps an acknowledgement when nothing got worse', () => {
    const acknowledged = {
      ...open('oxygen-low'),
      acknowledgedAt: addDays(t0, 0.2),
      acknowledgedBy: 'per-tait',
    };
    const result = reconcile([acknowledged], [wanted('oxygen-low')], options());
    expect(result.unchanged[0]?.acknowledgedAt).toBe(addDays(t0, 0.2));
  });
});

describe('acknowledging and clearing by hand', () => {
  it('records who and when', () => {
    const result = acknowledge(open('oxygen-low'), 'per-tait', t1);
    expect(result.acknowledgedBy).toBe('per-tait');
    expect(needsAttention(result)).toBe(false);
  });

  it('will not acknowledge something already closed', () => {
    const closed = { ...open('oxygen-low'), clearedAt: t0 };
    expect(acknowledge(closed, 'per-tait', t1)).toBe(closed);
  });

  it('clears once and only once', () => {
    const cleared = clear(open('oxygen-low'), t1);
    expect(cleared.clearedAt).toBe(t1);
    expect(clear(cleared, addDays(t1, 1))).toBe(cleared);
  });

  it('measures how long an alert stood', () => {
    expect(openHours(open('oxygen-low'))).toBeNull();
    expect(openHours(clear(open('oxygen-low'), t1))).toBeCloseTo(24, 9);
  });
});

describe('the summary', () => {
  it('counts what is open and what still needs looking at', () => {
    const summary = summarise([
      open('lice-over-limit', 'urgent'),
      { ...open('oxygen-low'), acknowledgedAt: t0, acknowledgedBy: 'per-tait' },
      { ...open('net-due-for-change', 'info'), clearedAt: t0 },
    ]);
    expect(summary.open).toBe(2);
    expect(summary.unacknowledged).toBe(1);
    expect(summary.urgent).toBe(1);
    expect(summary.worst).toBe('urgent');
  });

  it('counts the ones carrying a deadline', () => {
    const summary = summarise([{ ...open('lice-over-limit', 'urgent'), actByAt: addDays(t0, 14) }]);
    expect(summary.regulatory).toBe(1);
  });

  it('reads clear on a quiet site', () => {
    expect(summarise([])).toMatchObject({ open: 0, worst: null });
  });
});
