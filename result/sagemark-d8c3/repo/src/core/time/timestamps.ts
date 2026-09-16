import { formatDistanceToNowStrict, formatISO, parseISO } from 'date-fns'

export type ISOTimestamp = string & { readonly __iso: unique symbol }

export function now(): ISOTimestamp {
  return formatISO(new Date()) as ISOTimestamp
}

export function asTimestamp(value: Date | string): ISOTimestamp {
  if (value instanceof Date) return formatISO(value) as ISOTimestamp
  // Tolerate already-iso strings without re-parsing churn
  if (looksIso(value)) return value as ISOTimestamp
  return formatISO(parseISO(value)) as ISOTimestamp
}

export function toDate(ts: ISOTimestamp): Date {
  return parseISO(ts)
}

export function relativeFromNow(ts: ISOTimestamp): string {
  return formatDistanceToNowStrict(parseISO(ts), { addSuffix: true })
}

export function compareTimestamp(a: ISOTimestamp, b: ISOTimestamp): number {
  // Lexical compare works for well-formed ISO strings
  if (a < b) return -1
  if (a > b) return 1
  return 0
}

export function isAfter(a: ISOTimestamp, b: ISOTimestamp): boolean {
  return compareTimestamp(a, b) > 0
}

function looksIso(v: string): boolean {
  if (v.length < 10) return false
  if (v[4] !== '-' || v[7] !== '-') return false
  return !isNaN(Date.parse(v))
}
