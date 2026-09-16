import { describe, expect, it } from 'vitest';

import { penId, personId, siteId } from '@/domain/ids';
import {
  byPenNumber,
  distanceNm,
  isUsable,
  NET_SERVICE_WEEKS,
  netAgeWeeks,
  netDueForChange,
  PEN_STATUS_LABELS,
  type Pen,
  SITE_STATUS_LABELS,
  type Site,
  siteVolumeM3,
} from '@/domain/site/types';
import { addWeeks, parseInstant } from '@/domain/time/duration';

const now = parseInstant('2025-05-12T09:00:00Z');

const site: Site = {
  id: siteId('site-1'),
  code: 'FS-0412',
  name: 'Eilean Dubh',
  operator: 'Caledonian Marine',
  regime: 'scotland',
  position: { latitude: 57.4218, longitude: -5.9104 },
  maxBiomassT: 2_500,
  fallowWeeks: 6,
  status: 'stocked',
  manager: personId('per-tait'),
  depthM: 42,
  notes: '',
};

function pen(overrides: Partial<Pen> = {}): Pen {
  return {
    id: penId('pen-3'),
    siteId: site.id,
    number: 3,
    geometry: { circumferenceM: 120, depthM: 20 },
    status: 'stocked',
    netInstalledAt: addWeeks(now, -40),
    notes: '',
    ...overrides,
  };
}

describe('pen usability', () => {
  it('counts a stocked or empty pen as usable', () => {
    expect(isUsable(pen({ status: 'stocked' }))).toBe(true);
    expect(isUsable(pen({ status: 'empty' }))).toBe(true);
  });

  it('rules out a pen under maintenance or withdrawn', () => {
    expect(isUsable(pen({ status: 'maintenance' }))).toBe(false);
    expect(isUsable(pen({ status: 'withdrawn' }))).toBe(false);
  });

  it('names every status', () => {
    expect(Object.keys(PEN_STATUS_LABELS)).toHaveLength(4);
    expect(Object.keys(SITE_STATUS_LABELS)).toHaveLength(4);
  });
});

describe('pen ordering', () => {
  it('reads them in grid order, as the barge does', () => {
    const pens = [pen({ number: 7 }), pen({ number: 2 }), pen({ number: 11 })];
    expect([...pens].sort(byPenNumber).map((entry) => entry.number)).toEqual([2, 7, 11]);
  });
});

describe('net service life', () => {
  it('ages a net in whole weeks', () => {
    expect(netAgeWeeks(pen(), now)).toBe(40);
  });

  it('has no age for a pen with no net recorded', () => {
    expect(netAgeWeeks(pen({ netInstalledAt: null }), now)).toBeNull();
    expect(netDueForChange(pen({ netInstalledAt: null }), now)).toBe(false);
  });

  it('comes due at the service interval and not before', () => {
    const nearly = pen({ netInstalledAt: addWeeks(now, -(NET_SERVICE_WEEKS - 1)) });
    const due = pen({ netInstalledAt: addWeeks(now, -NET_SERVICE_WEEKS) });
    expect(netDueForChange(nearly, now)).toBe(false);
    expect(netDueForChange(due, now)).toBe(true);
  });
});

describe('site volume', () => {
  it('adds up the pens that can hold fish', () => {
    const pens = [pen({ number: 1 }), pen({ number: 2 }), pen({ number: 3 })];
    const one = Math.PI * (120 / (2 * Math.PI)) ** 2 * 20;
    expect(siteVolumeM3(pens)).toBeCloseTo(one * 3, 3);
  });

  it('leaves out the ones that cannot', () => {
    const pens = [pen({ number: 1 }), pen({ number: 2, status: 'withdrawn' })];
    const one = Math.PI * (120 / (2 * Math.PI)) ** 2 * 20;
    expect(siteVolumeM3(pens)).toBeCloseTo(one, 3);
  });

  it('is nothing for a site with no pens', () => {
    expect(siteVolumeM3([])).toBe(0);
  });
});

describe('distance between positions', () => {
  it('is nothing between a position and itself', () => {
    expect(distanceNm(site.position, site.position)).toBeCloseTo(0, 9);
  });

  it('gives a degree of latitude as sixty nautical miles', () => {
    const north = { latitude: site.position.latitude + 1, longitude: site.position.longitude };
    expect(distanceNm(site.position, north)).toBeCloseTo(60, 0);
  });

  it('shortens a degree of longitude at this latitude', () => {
    const east = { latitude: site.position.latitude, longitude: site.position.longitude + 1 };
    // At 57 degrees north a degree of longitude is about 32 nautical miles.
    expect(distanceNm(site.position, east)).toBeCloseTo(32, 0);
  });

  it('is symmetric', () => {
    const other = { latitude: 58.1, longitude: -6.4 };
    expect(distanceNm(site.position, other)).toBeCloseTo(distanceNm(other, site.position), 9);
  });
});
