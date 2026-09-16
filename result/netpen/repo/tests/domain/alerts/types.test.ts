import { describe, expect, it } from 'vitest';

import {
  ALERT_LABELS,
  type Alert,
  alertKey,
  byUrgency,
  DEFAULT_SEVERITY,
  isAcknowledged,
  isOpen,
  isRegulatory,
  needsAttention,
  REGULATORY_KINDS,
  SEVERITY_RANK,
} from '@/domain/alerts/types';
import { alertId, groupId, penId, siteId } from '@/domain/ids';
import { addDays, parseInstant } from '@/domain/time/duration';

const now = parseInstant('2025-05-12T09:00:00Z');
const site = siteId('site-1');

function alert(overrides: Partial<Alert> = {}): Alert {
  return {
    id: alertId('alr-1'),
    kind: 'lice-over-limit',
    severity: 'urgent',
    subject: { type: 'site', siteId: site },
    raisedAt: now,
    clearedAt: null,
    acknowledgedAt: null,
    acknowledgedBy: null,
    message: '',
    observed: null,
    limit: null,
    actByAt: null,
    ...overrides,
  };
}

describe('identity', () => {
  it('keys the same condition the same way every time', () => {
    const subject = { type: 'pen', penId: penId('pen-3'), siteId: site } as const;
    expect(alertKey('oxygen-low', subject)).toBe(alertKey('oxygen-low', subject));
  });

  it('keys different subjects apart', () => {
    const keys = [
      alertKey('oxygen-low', { type: 'site', siteId: site }),
      alertKey('oxygen-low', { type: 'pen', penId: penId('pen-3'), siteId: site }),
      alertKey('oxygen-low', { type: 'group', groupId: groupId('grp-1'), penId: penId('pen-3') }),
    ];
    expect(new Set(keys).size).toBe(3);
  });

  it('keys different kinds about the same subject apart', () => {
    const subject = { type: 'site', siteId: site } as const;
    expect(alertKey('oxygen-low', subject)).not.toBe(alertKey('lice-over-limit', subject));
  });
});

describe('open and acknowledged', () => {
  it('is open until it is cleared', () => {
    expect(isOpen(alert())).toBe(true);
    expect(isOpen(alert({ clearedAt: now }))).toBe(false);
  });

  it('needs attention only while open and unacknowledged', () => {
    expect(needsAttention(alert())).toBe(true);
    expect(needsAttention(alert({ acknowledgedAt: now, acknowledgedBy: 'per-tait' }))).toBe(false);
    expect(needsAttention(alert({ clearedAt: now }))).toBe(false);
    expect(isAcknowledged(alert({ acknowledgedAt: now }))).toBe(true);
  });
});

describe('the catalogue', () => {
  it('names and grades every kind', () => {
    const kinds = Object.keys(ALERT_LABELS) as (keyof typeof ALERT_LABELS)[];
    expect(kinds).toHaveLength(13);
    for (const kind of kinds) {
      expect(ALERT_LABELS[kind]).toBeTruthy();
      expect(SEVERITY_RANK[DEFAULT_SEVERITY[kind]]).toBeGreaterThanOrEqual(0);
    }
  });

  it('marks the ones that involve somebody outside the company', () => {
    expect(REGULATORY_KINDS).toHaveLength(4);
    for (const kind of REGULATORY_KINDS) {
      expect(isRegulatory(kind)).toBe(true);
      expect(DEFAULT_SEVERITY[kind]).not.toBe('info');
    }
    expect(isRegulatory('net-due-for-change')).toBe(false);
  });

  it('ranks urgent above warning above info', () => {
    expect(SEVERITY_RANK.urgent).toBeLessThan(SEVERITY_RANK.warning);
    expect(SEVERITY_RANK.warning).toBeLessThan(SEVERITY_RANK.info);
  });
});

describe('ordering', () => {
  it('puts urgent first whatever the deadline', () => {
    const urgent = alert({ severity: 'urgent' });
    const soonWarning = alert({ severity: 'warning', actByAt: addDays(now, 1) });
    expect([soonWarning, urgent].sort(byUrgency)[0]).toBe(urgent);
  });

  it('puts the nearest deadline first within a severity', () => {
    const soon = alert({ severity: 'warning', actByAt: addDays(now, 2) });
    const later = alert({ severity: 'warning', actByAt: addDays(now, 9) });
    expect([later, soon].sort(byUrgency)[0]).toBe(soon);
  });

  it('puts anything with a deadline ahead of anything without', () => {
    const dated = alert({ severity: 'warning', actByAt: addDays(now, 30) });
    const undated = alert({ severity: 'warning' });
    expect([undated, dated].sort(byUrgency)[0]).toBe(dated);
  });

  it('falls back to the most recent', () => {
    const older = alert({ severity: 'info', raisedAt: addDays(now, -5) });
    const newer = alert({ severity: 'info', raisedAt: now });
    expect([older, newer].sort(byUrgency)[0]).toBe(newer);
  });
});
