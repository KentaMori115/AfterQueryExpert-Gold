import { describe, expect, it } from 'vitest';

import {
  CAUSE_LABELS,
  countByCause,
  cumulativePercent,
  dailyRatePercent,
  ELEVATED_DAILY_PERCENT,
  formatPercent,
  INCIDENT_DAILY_PERCENT,
  isOperational,
  LEVEL_LABELS,
  levelFor,
  MORTALITY_CAUSES,
  type MortalityRecord,
  standingCount,
  survivalPercent,
  totalBiomassKg,
  totalCount,
} from '@/domain/health/mortality';
import { addDays, parseInstant } from '@/domain/time/duration';

const start = parseInstant('2025-05-05T00:00:00Z');

const records: MortalityRecord[] = [
  { at: start, count: 40, meanWeightG: 3_200, cause: 'natural' },
  { at: addDays(start, 1), count: 35, meanWeightG: 3_210, cause: 'natural' },
  { at: addDays(start, 2), count: 620, meanWeightG: 3_180, cause: 'treatment' },
  { at: addDays(start, 3), count: 90, meanWeightG: 3_220, cause: 'winter-ulcer' },
  { at: addDays(start, 4), count: 25, meanWeightG: 3_240, cause: 'predation' },
];

describe('causes', () => {
  it('names every cause it records', () => {
    expect(MORTALITY_CAUSES).toHaveLength(10);
    for (const cause of MORTALITY_CAUSES) {
      expect(CAUSE_LABELS[cause]).toBeTruthy();
    }
  });

  it('separates what the site did from what happened to it', () => {
    expect(isOperational('handling')).toBe(true);
    expect(isOperational('treatment')).toBe(true);
    expect(isOperational('jellyfish')).toBe(false);
    expect(isOperational('natural')).toBe(false);
  });
});

describe('totals', () => {
  it('adds the fish', () => {
    expect(totalCount(records)).toBe(810);
    expect(totalCount([])).toBe(0);
  });

  it('adds the biomass at the weight they died at', () => {
    expect(totalBiomassKg(records)).toBeCloseTo(
      (40 * 3_200 + 35 * 3_210 + 620 * 3_180 + 90 * 3_220 + 25 * 3_240) / 1_000,
      6,
    );
  });

  it('breaks the count down by cause', () => {
    const tally = countByCause(records);
    expect(tally.treatment).toBe(620);
    expect(tally.natural).toBe(75);
    expect(tally.jellyfish).toBe(0);
  });

  it('gives every cause a zero rather than leaving it out', () => {
    expect(Object.keys(countByCause([]))).toHaveLength(MORTALITY_CAUSES.length);
  });
});

describe('what is still in the pen', () => {
  it('nets the record off what went in', () => {
    expect(standingCount(200_000, records)).toBe(199_190);
  });

  it('takes off what has been harvested', () => {
    expect(standingCount(200_000, records, 50_000)).toBe(149_190);
  });

  it('never goes below zero on a bad record', () => {
    expect(standingCount(500, records)).toBe(0);
  });
});

describe('cumulative loss', () => {
  it('is a share of what was put in', () => {
    expect(cumulativePercent(200_000, records)).toBeCloseTo(0.405, 6);
  });

  it('and survival is the rest of it', () => {
    expect(survivalPercent(200_000, records)).toBeCloseTo(99.595, 6);
  });

  it('is nothing when nothing was stocked', () => {
    expect(cumulativePercent(0, records)).toBe(0);
  });
});

describe('the daily rate', () => {
  it('is a share of the standing population per day', () => {
    // 75 fish over the first two days out of 200 000 standing.
    const rate = dailyRatePercent(records, 200_000, start, addDays(start, 2));
    expect(rate).toBeCloseTo((75 / 200_000 / 2) * 100, 9);
  });

  it('counts the window closed at the start and open at the end', () => {
    const rate = dailyRatePercent(records, 200_000, start, addDays(start, 1));
    expect(rate).toBeCloseTo((40 / 200_000) * 100, 9);
  });

  it('picks up the treatment day as a much larger rate', () => {
    const quiet = dailyRatePercent(records, 200_000, start, addDays(start, 2))!;
    const treatment = dailyRatePercent(records, 200_000, addDays(start, 2), addDays(start, 3))!;
    expect(treatment).toBeGreaterThan(quiet * 10);
  });

  it('has no rate without a population or a window', () => {
    expect(dailyRatePercent(records, 0, start, addDays(start, 2))).toBeNull();
    expect(dailyRatePercent(records, 200_000, start, start)).toBeNull();
  });

  it('shows the same count differently in a small pen', () => {
    const big = dailyRatePercent(records, 200_000, addDays(start, 3), addDays(start, 4))!;
    const small = dailyRatePercent(records, 8_000, addDays(start, 3), addDays(start, 4))!;
    expect(levelFor(big)).toBe('normal');
    expect(levelFor(small)).toBe('incident');
  });
});

describe('levels', () => {
  it('places each level where the site acts', () => {
    expect(levelFor(0.01)).toBe('normal');
    expect(levelFor(ELEVATED_DAILY_PERCENT)).toBe('elevated');
    expect(levelFor(0.1)).toBe('elevated');
    expect(levelFor(INCIDENT_DAILY_PERCENT)).toBe('incident');
  });

  it('says so rather than guessing when there is nothing to measure', () => {
    expect(levelFor(null)).toBe('unknown');
    expect(levelFor(Number.NaN)).toBe('unknown');
  });

  it('has a sentence for every level', () => {
    expect(Object.keys(LEVEL_LABELS)).toHaveLength(4);
    expect(LEVEL_LABELS.incident).toContain('report');
  });
});

describe('formatting', () => {
  it('writes a percentage to the digits asked for', () => {
    expect(formatPercent(0.4051)).toBe('0.41 %');
    expect(formatPercent(0.4051, 3)).toBe('0.405 %');
    expect(formatPercent(null)).toBe('—');
  });
});
