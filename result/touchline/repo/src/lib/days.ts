/**
 * A day is a string, `YYYY-MM-DD`, and never a timestamp.
 *
 * The league argues about days, not instants: a fixture is played on a day, a
 * registration closes on a day, a suspension covers whole fixtures. Keeping the
 * day a string means yesterday's table can be recomputed exactly, and it keeps
 * a reader's timezone out of the answer.
 *
 * A string shaped like a day but naming a day that never happened
 * (`2033-02-30`) is well formed, so it is refused as a 409 rather than a 400.
 * The syntax check belongs to the schema; the calendar check belongs here.
 */
import { ConflictError } from './AppError';

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function looksLikeDay(value: string): boolean {
  return DAY_PATTERN.test(value);
}

/** True when the string names a day the calendar actually has. */
export function isRealDay(day: string): boolean {
  if (!looksLikeDay(day)) return false;
  const [year, month, date] = day.split('-').map(Number) as [number, number, number];
  if (month < 1 || month > 12 || date < 1) return false;
  const asDate = new Date(Date.UTC(year, month - 1, date));
  return (
    asDate.getUTCFullYear() === year &&
    asDate.getUTCMonth() === month - 1 &&
    asDate.getUTCDate() === date
  );
}

/** Refuses a day the calendar does not have. The syntax is already the schema's business. */
export function requireRealDay(day: string, label: string): string {
  if (!isRealDay(day)) {
    throw new ConflictError(`${label} names a day that does not exist`, { [label]: day });
  }
  return day;
}

/** Days compare correctly as strings, which is the whole point of the format. */
export function isBefore(left: string, right: string): boolean {
  return left < right;
}

export function isAfter(left: string, right: string): boolean {
  return left > right;
}

/** Whole days between two days, negative when `to` precedes `from`. */
export function daysBetween(from: string, to: string): number {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  return Math.round((end - start) / 86_400_000);
}

/** The day `count` days after `day`, still as a string. */
export function addDays(day: string, count: number): string {
  const moved = new Date(Date.parse(`${day}T00:00:00Z`) + count * 86_400_000);
  const parts = moved.toISOString().split('T');
  return parts[0] ?? day;
}
