/**
 * Presentation formatting.
 *
 * Two rules run through all of it. A number in a column is rendered with
 * tabular figures and a fixed number of decimals so the decimal points line
 * up; a column of lice counts that jitters is unreadable at a glance. And a
 * missing value is always an em dash, never a zero: on a monitoring screen the
 * difference between "nobody counted" and "counted, found none" is the
 * difference between a job to do and a job done.
 */

export const MISSING = '—';

function usable(value: number | null | undefined): value is number {
  return value !== null && value !== undefined && Number.isFinite(value);
}

export function formatNumber(value: number | null | undefined, digits = 1): string {
  return usable(value) ? value.toFixed(digits) : MISSING;
}

export function formatInteger(value: number | null | undefined): string {
  return usable(value) ? Math.round(value).toLocaleString('en-GB') : MISSING;
}

export function formatPercent(value: number | null | undefined, digits = 1): string {
  return usable(value) ? `${value.toFixed(digits)} %` : MISSING;
}

export function formatSigned(value: number | null | undefined, digits = 2): string {
  if (!usable(value)) return MISSING;
  const rendered = value.toFixed(digits);
  return value > 0 ? `+${rendered}` : rendered;
}

const DATE_TIME = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: 'UTC',
});

const DATE_ONLY = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

export function formatDateTime(instant: number | null | undefined): string {
  return usable(instant) ? DATE_TIME.format(new Date(instant)).replace(',', '') : MISSING;
}

export function formatDate(instant: number | null | undefined): string {
  return usable(instant) ? DATE_ONLY.format(new Date(instant)) : MISSING;
}

/** Coarse relative time, never more precise than a day past a week. */
export function formatRelative(instant: number | null | undefined, now: number): string {
  if (!usable(instant)) return MISSING;
  const hours = (now - instant) / 3_600_000;
  const ahead = hours < 0;
  const magnitude = Math.abs(hours);

  let phrase: string;
  if (magnitude < 1) phrase = 'under an hour';
  else if (magnitude < 48) phrase = `${Math.round(magnitude)} h`;
  else if (magnitude < 24 * 21) phrase = `${Math.round(magnitude / 24)} d`;
  else phrase = `${Math.round(magnitude / 168)} wk`;

  return ahead ? `in ${phrase}` : `${phrase} ago`;
}

export function pluralise(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function joinPhrases(items: readonly string[]): string {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0]!;
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]!}`;
}
