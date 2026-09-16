import { describe, expect, it } from 'vitest';

import { liceAlerts, merge, siteAlerts, stockAlerts, waterAlerts } from '@/domain/alerts/rules';
import {
  ALERT_LABELS,
  alertKey,
  byUrgency,
  DEFAULT_SEVERITY,
  isRegulatory,
  type Alert,
} from '@/domain/alerts/types';
import { groupId, penId, siteId, alertId } from '@/domain/ids';
import { addDays, parseInstant } from '@/domain/time/duration';

const now = parseInstant('2025-05-12T09:00:00Z');
const group = groupId('grp-s24-p3');
const pen = penId('pen-3');
const site = siteId('site-1');

const liceBase = {
  groupId: group,
  penId: pen,
  regime: 'norway' as const,
  week: { year: 2025, week: 20 },
  adultFemale: 0.12,
  countedAt: addDays(now, -3),
  now,
  countIntervalDays: 7,
  daysToAct: 14,
};

describe('lice rules', () => {
  it('says nothing about a clean pen counted recently', () => {
    expect(liceAlerts(liceBase)).toEqual([]);
  });

  it('raises a breach with the deadline attached', () => {
    const [alert] = liceAlerts({ ...liceBase, adultFemale: 0.34 });
    expect(alert?.kind).toBe('lice-over-limit');
    expect(alert?.severity).toBe('urgent');
    expect(alert?.actByAt).toBe(addDays(liceBase.countedAt, 14));
    expect(alert?.limit).toBe(0.2);
  });

  it('uses the tighter spring limit inside the window', () => {
    // 0.34 is inside the limit in week 30 and over it in week 20.
    expect(liceAlerts({ ...liceBase, adultFemale: 0.34, week: { year: 2025, week: 30 } })).toEqual(
      [],
    );
  });

  it('warns before the limit rather than only at it', () => {
    const [alert] = liceAlerts({ ...liceBase, adultFemale: 0.17 });
    expect(alert?.kind).toBe('lice-approaching');
    expect(alert?.severity).toBe('warning');
  });

  it('raises separately when nobody has counted', () => {
    const alerts = liceAlerts({ ...liceBase, countedAt: addDays(now, -12) });
    expect(alerts.map((alert) => alert.kind)).toContain('lice-count-overdue');
  });

  it('can raise a breach and an overdue count at once', () => {
    const alerts = liceAlerts({
      ...liceBase,
      adultFemale: 0.4,
      countedAt: addDays(now, -20),
    });
    expect(alerts).toHaveLength(2);
  });
});

describe('water rules', () => {
  const waterBase = { penId: pen, siteId: site, saturationPercent: 92, temperatureC: 12.4 };

  it('says nothing about comfortable water', () => {
    expect(waterAlerts(waterBase)).toEqual([]);
  });

  it('raises low oxygen as a warning and critical as urgent', () => {
    expect(waterAlerts({ ...waterBase, saturationPercent: 64 })[0]?.kind).toBe('oxygen-low');
    expect(waterAlerts({ ...waterBase, saturationPercent: 44 })[0]?.severity).toBe('urgent');
  });

  it('flags a probe out of the water', () => {
    const alerts = waterAlerts({ ...waterBase, temperatureC: 41 });
    expect(alerts.map((alert) => alert.kind)).toContain('temperature-extreme');
  });

  it('says nothing about supersaturation, which is not this rule', () => {
    expect(waterAlerts({ ...waterBase, saturationPercent: 118 })).toEqual([]);
  });
});

describe('stock rules', () => {
  const stockBase = {
    groupId: group,
    penId: pen,
    dailyMortalityPercent: 0.01,
    densityKgM3: 14,
    withdrawalRemaining: 0,
    harvestPlanned: false,
  };

  it('says nothing about a healthy pen', () => {
    expect(stockAlerts(stockBase)).toEqual([]);
  });

  it('separates elevated mortality from an incident', () => {
    expect(stockAlerts({ ...stockBase, dailyMortalityPercent: 0.08 })[0]?.kind).toBe(
      'mortality-elevated',
    );
    expect(stockAlerts({ ...stockBase, dailyMortalityPercent: 0.3 })[0]?.kind).toBe(
      'mortality-incident',
    );
  });

  it('raises density only above the limit', () => {
    expect(stockAlerts({ ...stockBase, densityKgM3: 23 })).toEqual([]);
    expect(stockAlerts({ ...stockBase, densityKgM3: 27 })[0]?.kind).toBe('density-over-limit');
  });

  it('raises a withdrawal only when a harvest is actually planned', () => {
    expect(stockAlerts({ ...stockBase, withdrawalRemaining: 90 })).toEqual([]);
    const blocked = stockAlerts({ ...stockBase, withdrawalRemaining: 90, harvestPlanned: true });
    expect(blocked[0]?.kind).toBe('withdrawal-blocking-harvest');
    expect(blocked[0]?.message).toContain('90');
  });

  it('says nothing when there is no mortality figure to judge', () => {
    expect(stockAlerts({ ...stockBase, dailyMortalityPercent: null })).toEqual([]);
  });
});

describe('site rules', () => {
  const position = {
    standingT: 2_400,
    limitT: 3_120,
    headroomT: 720,
    utilisation: 2_400 / 3_120,
    overLimit: false,
  };

  it('says nothing well inside the licence', () => {
    expect(siteAlerts({ siteId: site, licence: position, nearFraction: 0.85 })).toEqual([]);
  });

  it('warns as the ceiling comes up', () => {
    const near = { ...position, standingT: 2_800, utilisation: 2_800 / 3_120 };
    const [alert] = siteAlerts({ siteId: site, licence: near, nearFraction: 0.85 });
    expect(alert?.kind).toBe('biomass-near-licence');
    expect(alert?.message).toContain('90 percent');
  });

  it('raises a breach as urgent and drops the warning', () => {
    const over = { ...position, standingT: 3_200, utilisation: 3_200 / 3_120, overLimit: true };
    const alerts = siteAlerts({ siteId: site, licence: over, nearFraction: 0.85 });
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.kind).toBe('biomass-over-licence');
    expect(alerts[0]?.severity).toBe('urgent');
  });
});

describe('merging', () => {
  it('keeps one alert per key', () => {
    const twice = merge([
      liceAlerts({ ...liceBase, adultFemale: 0.4 }),
      liceAlerts({ ...liceBase, adultFemale: 0.4 }),
    ]);
    expect(twice).toHaveLength(1);
  });

  it('keeps alerts about different things apart', () => {
    const merged = merge([
      liceAlerts({ ...liceBase, adultFemale: 0.4 }),
      waterAlerts({ penId: pen, siteId: site, saturationPercent: 44, temperatureC: 12 }),
    ]);
    expect(merged).toHaveLength(2);
  });
});

describe('the alert model', () => {
  it('keys on the subject, so the same condition is the same alert', () => {
    const first = alertKey('lice-over-limit', { type: 'group', groupId: group, penId: pen });
    const second = alertKey('lice-over-limit', { type: 'group', groupId: group, penId: pen });
    expect(first).toBe(second);
  });

  it('names and grades every kind', () => {
    for (const kind of Object.keys(ALERT_LABELS) as (keyof typeof ALERT_LABELS)[]) {
      expect(ALERT_LABELS[kind]).toBeTruthy();
      expect(DEFAULT_SEVERITY[kind]).toBeTruthy();
    }
  });

  it('knows which alerts carry an obligation outside the company', () => {
    expect(isRegulatory('lice-over-limit')).toBe(true);
    expect(isRegulatory('biomass-over-licence')).toBe(true);
    expect(isRegulatory('net-due-for-change')).toBe(false);
  });

  it('sorts urgent first, then by deadline, then by recency', () => {
    const make = (overrides: Partial<Alert>): Alert => ({
      id: alertId('a'),
      kind: 'lice-over-limit',
      severity: 'warning',
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
    });

    const urgent = make({ severity: 'urgent' });
    const soon = make({ actByAt: addDays(now, 2) });
    const later = make({ actByAt: addDays(now, 9) });
    const undated = make({ raisedAt: addDays(now, -5) });

    const sorted = [undated, later, soon, urgent].sort(byUrgency);
    expect(sorted[0]).toBe(urgent);
    expect(sorted[1]).toBe(soon);
    expect(sorted[2]).toBe(later);
    expect(sorted[3]).toBe(undated);
  });
});
