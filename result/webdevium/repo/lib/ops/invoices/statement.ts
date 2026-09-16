import { settleRounding, sumCents } from '@/lib/ops/billing/money'
import { convertAmount, lookupRate, parseRateTable } from './fx.js'

export type StatementKind = 'subscription' | 'overage' | 'credit' | 'tax'

/** The ref a tax entry carries, since no plan or balance produced it. */
export const TAX_REF = 'tax'

/**
 * One line of a statement: what kind of charge it is, what produced it, and
 * what it costs. A plan id or a balance id in `ref` is enough to trace a
 * figure back without carrying prose that would have to be translated.
 */
export type StatementLine = {
  kind: StatementKind
  ref: string
  cents: number
}

export type ConversionResult = {
  rate: number
  lines: StatementLine[]
  subtotalCents: number
}

/** Statement money is whole cents, so conversion happens at cent scale. */
export const CENT_SCALE = 0

export function convertCents(cents: number, rate: number) {
  return convertAmount(cents, rate, CENT_SCALE)
}

/**
 * Convert priced lines into the currency a client is billed in.
 *
 * Every line converts on its own, because a client reading the statement will
 * check a line against the rate and expect it to come out. Converting each
 * line independently and converting the bill once do not have to agree to the
 * cent, so the set is nudged back onto the single converted total: the lines
 * and the total never disagree, and the difference sits where it is least
 * visible rather than being spread across every row.
 */
export function convertStatementLines(
  lines: StatementLine[],
  from: string,
  to: string,
  ratesCsv: string
): ConversionResult {
  const rate = lookupRate(parseRateTable(ratesCsv), from, to)
  const subtotalCents = convertCents(sumCents(lines.map((line) => line.cents)), rate)
  const converted = lines.map((line) => convertCents(line.cents, rate))
  const settled = settleRounding(converted, subtotalCents)

  return {
    rate,
    subtotalCents,
    lines: lines.map((line, index) => ({ ...line, cents: settled[index] })),
  }
}
