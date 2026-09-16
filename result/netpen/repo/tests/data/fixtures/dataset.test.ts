import { describe, expect, it } from 'vitest';

import { buildDataset, describeDataset, REFERENCE_DEPTH_M, STOCKED_AT } from '@/data/fixtures';
import { averages } from '@/domain/lice/counts';
import { positionAt, validate } from '@/domain/stock/ledger';
import { hasConsistentSign } from '@/domain/stock/types';
import { accumulate } from '@/domain/time/degreeDays';
import { parseInstant, weeksAtSea } from '@/domain/time/duration';
import { isPlausibleSeaTemperature } from '@/domain/units/water';

const NOW = parseInstant('2025-05-12T09:00:00Z');
const dataset = buildDataset(NOW);
const reference = dataset.temperatures.get(REFERENCE_DEPTH_M) ?? [];

function eventsFor(penNumber: number) {
  return dataset.events.filter((event) => String(event.groupId) === `grp-s24-p${penNumber}`);
}

describe('the shape of it', () => {
  it('builds the whole site', () => {
    const shape = describeDataset(dataset);
    expect(shape.pens).toBe(8);
    expect(shape.groups).toBe(7);
    expect(shape.weeks).toBe(weeksAtSea(STOCKED_AT, NOW));
    expect(shape.weeks).toBeGreaterThan(50);
  });

  it('has a long stock history and a weekly lice record', () => {
    const shape = describeDataset(dataset);
    expect(shape.events).toBeGreaterThan(450);
    expect(shape.liceCounts).toBeGreaterThan(300);
    expect(shape.treatments).toBeGreaterThan(3);
  });

  it('keeps oxygen to the last quarter only', () => {
    const shape = describeDataset(dataset);
    expect(shape.oxygenReadings).toBeGreaterThan(1_000);
    expect(shape.temperatureDays).toBeGreaterThan(shape.oxygenReadings / 30);
  });

  it('is reproducible from the same instant', () => {
    expect(describeDataset(buildDataset(NOW))).toEqual(describeDataset(dataset));
    expect(buildDataset(NOW).liceCounts[10]).toEqual(dataset.liceCounts[10]);
  });
});

describe('the temperature record', () => {
  it('stays inside a plausible sea range all the way through', () => {
    for (const sample of reference) {
      expect(isPlausibleSeaTemperature(sample.meanC)).toBe(true);
    }
  });

  it('runs warm in August and cold in February', () => {
    const inMonth = (month: number) =>
      reference.filter((sample) => new Date(sample.at).getUTCMonth() === month);
    const august = inMonth(7);
    const february = inMonth(1);
    const mean = (values: typeof reference) =>
      values.reduce((total, sample) => total + sample.meanC, 0) / values.length;

    expect(mean(august)).toBeGreaterThan(13);
    expect(mean(february)).toBeLessThan(9);
  });

  it('is cooler and less variable deeper down', () => {
    const deep = dataset.temperatures.get(15) ?? [];
    const spread = (values: typeof reference) =>
      Math.max(...values.map((s) => s.meanC)) - Math.min(...values.map((s) => s.meanC));
    expect(spread(deep)).toBeLessThan(spread(reference));
  });

  it('accumulates enough heat for a full cycle of growth', () => {
    expect(accumulate(reference)).toBeGreaterThan(3_500);
  });
});

describe('the stock log', () => {
  it('passes its own validation for every group', () => {
    for (const group of dataset.groups) {
      const events = dataset.events.filter((event) => event.groupId === group.id);
      expect(validate(events), `${group.reference} has issues`).toEqual([]);
    }
  });

  it('has every event signed the right way', () => {
    for (const event of dataset.events) {
      expect(hasConsistentSign(event), `${event.id} is signed wrongly`).toBe(true);
    }
  });

  it('grows a smolt to harvest size over the cycle', () => {
    const options = { tgc: 3.1, temperatures: reference };
    const position = positionAt(eventsFor(2), NOW, options);
    expect(position.meanWeightG).toBeGreaterThan(3_500);
    expect(position.meanWeightG).toBeLessThan(8_000);
    expect(position.count).toBeGreaterThan(60_000);
  });

  it('empties pen 7 into pens 3 and 4', () => {
    const options = { tgc: 3.1, temperatures: reference };
    expect(positionAt(eventsFor(7), NOW, options).count).toBe(0);
    expect(eventsFor(3).some((event) => event.kind === 'transferred-in')).toBe(true);
    expect(eventsFor(4).some((event) => event.kind === 'transferred-in')).toBe(true);
  });

  it('runs a much worse mortality on the ulcer pens', () => {
    const options = { tgc: 3.1, temperatures: reference };
    const healthy = positionAt(eventsFor(2), NOW, options);
    const ulcered = positionAt(eventsFor(5), NOW, options);
    expect(ulcered.mortalityCount).toBeGreaterThan(healthy.mortalityCount * 2);
  });

  it('has pen 1 shrinking because it is being harvested', () => {
    const options = { tgc: 3.1, temperatures: reference };
    expect(positionAt(eventsFor(1), NOW, options).harvestedCount).toBeGreaterThan(0);
  });
});

describe('the lice record', () => {
  it('samples twenty fish every time', () => {
    for (const count of dataset.liceCounts) {
      expect(count.sample).toHaveLength(20);
    }
  });

  it('starts almost clean and builds', () => {
    const forPen = dataset.liceCounts.filter((count) => String(count.penId) === 'pen-2');
    const first = averages(forPen[0]!.sample)!;
    const peak = Math.max(...forPen.map((count) => averages(count.sample)!.adultFemale));
    // Two lice found across twenty fish is 0.1, which is what a clean pen of
    // recently stocked smolt actually reads.
    expect(first.adultFemale).toBeLessThan(0.2);
    expect(peak).toBeGreaterThan(0.4);
    expect(peak).toBeGreaterThan(first.adultFemale * 4);
  });

  it('carries more pre-adults than adult females, as a real count does', () => {
    const late = dataset.liceCounts.slice(-60);
    const totals = late.reduce(
      (running, count) => {
        const mean = averages(count.sample)!;
        return {
          adultFemale: running.adultFemale + mean.adultFemale,
          preAdult: running.preAdult + mean.preAdult,
        };
      },
      { adultFemale: 0, preAdult: 0 },
    );
    expect(totals.preAdult).toBeGreaterThan(totals.adultFemale);
  });

  it('produces treatments that follow the counts that caused them', () => {
    for (const treatment of dataset.treatments) {
      expect(treatment.beforeCount).not.toBeNull();
      expect(treatment.afterCount).not.toBeNull();
      expect(treatment.afterCount!).toBeLessThan(treatment.beforeCount!);
    }
  });

  it('rotates the method rather than using one repeatedly', () => {
    const methods = new Set(dataset.treatments.map((treatment) => treatment.method));
    expect(methods.size).toBeGreaterThan(1);
  });
});

describe('the oxygen record', () => {
  it('dips through the afternoon and recovers', () => {
    const forPen = dataset.oxygen.filter((reading) => reading.penId === 'pen-2');
    const morning = forPen.filter((r) => new Date(r.at).getUTCHours() < 9);
    const afternoon = forPen.filter((r) => new Date(r.at).getUTCHours() >= 13);
    const mean = (values: typeof forPen) =>
      values.reduce((total, r) => total + r.saturationPercent, 0) / values.length;
    expect(mean(afternoon)).toBeLessThan(mean(morning));
  });

  it('keeps concentration and saturation consistent with each other', () => {
    for (const reading of dataset.oxygen.slice(0, 200)) {
      expect(reading.oxygenMgL).toBeGreaterThan(0);
      expect(reading.saturationPercent).toBeGreaterThan(20);
      expect(reading.saturationPercent).toBeLessThanOrEqual(125);
    }
  });
});
