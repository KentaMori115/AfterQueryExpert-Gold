/**
 * Time on a salmon site.
 *
 * A grow-out cycle runs somewhere between fourteen and twenty two months, and
 * essentially everything about it is tracked by week rather than by date. Feed
 * is ordered by week, lice are counted weekly and reported by week, growth is
 * budgeted week by week against a plan, and the harvest slot is booked as a
 * week number. The date is what a week is turned into at the last moment, for
 * a well boat schedule or a treatment record.
 *
 * ISO week numbering is used throughout, because that is what the reporting
 * regime and every supplier calendar already use. It is worth knowing that a
 * year has 52 or 53 of them and that the first days of January frequently
 * belong to the previous year's week 52 or 53.
 */

export type Instant = number;

export const MS_PER_HOUR = 3_600_000;
export const MS_PER_DAY = 86_400_000;
export const MS_PER_WEEK = 604_800_000;

export function parseInstant(iso: string): Instant {
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) {
    throw new TypeError(`Not a parseable timestamp: ${iso}`);
  }
  return parsed;
}

export function toIso(instant: Instant): string {
  return new Date(instant).toISOString();
}

export function daysBetween(from: Instant, to: Instant): number {
  return (to - from) / MS_PER_DAY;
}

export function addDays(instant: Instant, days: number): Instant {
  return instant + days * MS_PER_DAY;
}

export function addWeeks(instant: Instant, weeks: number): Instant {
  return instant + weeks * MS_PER_WEEK;
}

/** Midnight UTC at the start of the day an instant falls in. */
export function startOfDay(instant: Instant): Instant {
  return Math.floor(instant / MS_PER_DAY) * MS_PER_DAY;
}

/**
 * Whole days elapsed, floored. A fish put to sea at 16:00 on Monday is one day
 * at sea at 16:00 on Tuesday, not two, and a cycle length that rounds up is a
 * cycle length that overstates growth.
 */
export function wholeDaysBetween(from: Instant, to: Instant): number {
  return Math.floor(daysBetween(from, to));
}

export interface IsoWeek {
  /** The year the week belongs to, which is not always the calendar year. */
  readonly year: number;
  /** 1 to 53. */
  readonly week: number;
}

/**
 * ISO 8601 week number. Weeks start on Monday and week 1 is the one holding
 * the first Thursday of the year.
 */
export function isoWeekOf(instant: Instant): IsoWeek {
  const date = new Date(startOfDay(instant));
  // Shift to the Thursday of this week; the year of that Thursday is the
  // week-numbering year by definition.
  const day = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - day + 3);
  const year = date.getUTCFullYear();

  const firstThursday = Date.UTC(year, 0, 4);
  const firstDay = (new Date(firstThursday).getUTCDay() + 6) % 7;
  const week1Monday = firstThursday - firstDay * MS_PER_DAY;

  return { year, week: Math.round((date.getTime() - week1Monday) / MS_PER_WEEK) + 1 };
}

/** Monday 00:00 UTC of the ISO week an instant falls in. */
export function startOfIsoWeek(instant: Instant): Instant {
  const date = new Date(startOfDay(instant));
  const day = (date.getUTCDay() + 6) % 7;
  return startOfDay(instant) - day * MS_PER_DAY;
}

/** How many ISO weeks a year has: 52, or 53 when the year is long. */
export function weeksInIsoYear(year: number): number {
  const lastDay = Date.UTC(year, 11, 28);
  return isoWeekOf(lastDay).week;
}

export function formatIsoWeek(week: IsoWeek): string {
  return `${week.year}-W${String(week.week).padStart(2, '0')}`;
}

export function compareIsoWeeks(a: IsoWeek, b: IsoWeek): number {
  return a.year !== b.year ? a.year - b.year : a.week - b.week;
}

/**
 * Weeks since a stocking date, which is how everything on a pen is indexed.
 * Week zero is the week the fish went in.
 */
export function weeksAtSea(stockedAt: Instant, at: Instant): number {
  return Math.floor((startOfIsoWeek(at) - startOfIsoWeek(stockedAt)) / MS_PER_WEEK);
}

export function monthsAtSea(stockedAt: Instant, at: Instant): number {
  return daysBetween(stockedAt, at) / 30.436875;
}

/** Cycle age written the way it is spoken: "14 months, week 61". */
export function formatCycleAge(stockedAt: Instant, at: Instant): string {
  if (at < stockedAt) return '—';
  const months = Math.floor(monthsAtSea(stockedAt, at));
  return `${months} mo, week ${weeksAtSea(stockedAt, at)}`;
}

export interface DateRange {
  readonly from: Instant;
  readonly to: Instant;
}

export function makeRange(from: Instant, to: Instant): DateRange {
  if (to < from) {
    throw new RangeError('A date range cannot end before it starts');
  }
  return { from, to };
}

export function rangeContains(range: DateRange, instant: Instant): boolean {
  return instant >= range.from && instant < range.to;
}

export function rangeDays(range: DateRange): number {
  return daysBetween(range.from, range.to);
}
