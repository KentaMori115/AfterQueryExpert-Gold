import { describe, expect, it } from 'vitest';

import { addDays, parseInstant } from '@/domain/time/duration';
import {
  formatDate,
  formatDateTime,
  formatInteger,
  formatNumber,
  formatPercent,
  formatRelative,
  formatSigned,
  joinPhrases,
  MISSING,
  pluralise,
} from '@/ui/format';

const now = parseInstant('2025-05-12T09:00:00Z');

describe('numbers', () => {
  it('renders to a fixed number of decimals', () => {
    expect(formatNumber(0.4472)).toBe('0.4');
    expect(formatNumber(0.4472, 2)).toBe('0.45');
    expect(formatNumber(12, 0)).toBe('12');
  });

  it('renders integers with thousands separators', () => {
    expect(formatInteger(180_000)).toBe('180,000');
    expect(formatInteger(999)).toBe('999');
    expect(formatInteger(1_500.6)).toBe('1,501');
  });

  it('shows a dash for anything missing rather than a zero', () => {
    for (const render of [formatNumber, formatInteger, formatPercent, formatSigned]) {
      expect(render(null)).toBe(MISSING);
      expect(render(undefined)).toBe(MISSING);
      expect(render(Number.NaN)).toBe(MISSING);
      expect(render(Number.POSITIVE_INFINITY)).toBe(MISSING);
    }
  });

  it('keeps a genuine zero, which is not the same as nothing', () => {
    expect(formatNumber(0)).toBe('0.0');
    expect(formatInteger(0)).toBe('0');
    expect(formatPercent(0)).toBe('0.0 %');
  });

  it('marks the direction of a signed value', () => {
    expect(formatSigned(0.18)).toBe('+0.18');
    expect(formatSigned(-0.18)).toBe('-0.18');
    expect(formatSigned(0)).toBe('0.00');
  });
});

describe('instants', () => {
  it('renders a date and time without a comma', () => {
    expect(formatDateTime(now)).toBe('12 May 09:00');
    expect(formatDate(now)).toBe('12 May 2025');
  });

  it('shows a dash for a missing instant', () => {
    expect(formatDateTime(null)).toBe(MISSING);
    expect(formatDate(Number.NaN)).toBe(MISSING);
  });
});

describe('relative time', () => {
  it('steps up through hours, days and weeks', () => {
    expect(formatRelative(addDays(now, -0.02), now)).toBe('under an hour ago');
    expect(formatRelative(addDays(now, -1), now)).toBe('24 h ago');
    expect(formatRelative(addDays(now, -5), now)).toBe('5 d ago');
    expect(formatRelative(addDays(now, -40), now)).toBe('6 wk ago');
  });

  it('reads forwards for something still to come', () => {
    expect(formatRelative(addDays(now, 3), now)).toBe('in 3 d');
  });

  it('shows a dash for a missing instant', () => {
    expect(formatRelative(null, now)).toBe(MISSING);
  });
});

describe('text', () => {
  it('pluralises by count', () => {
    expect(pluralise(1, 'pen')).toBe('1 pen');
    expect(pluralise(0, 'pen')).toBe('0 pens');
    expect(pluralise(2, 'louse', 'lice')).toBe('2 lice');
  });

  it('joins a list the way a sentence would', () => {
    expect(joinPhrases([])).toBe('');
    expect(joinPhrases(['oxygen'])).toBe('oxygen');
    expect(joinPhrases(['oxygen', 'appetite'])).toBe('oxygen and appetite');
    expect(joinPhrases(['oxygen', 'appetite', 'starve'])).toBe('oxygen, appetite and starve');
  });
});
