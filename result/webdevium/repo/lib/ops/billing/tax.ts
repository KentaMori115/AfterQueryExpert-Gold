import { roundHalfEven } from './money'

/**
 * What the rate was charged on and what it came to. Both figures are reported
 * because a client who paid part of a cycle with a prepaid balance will want
 * to see which part the tax was worked out from.
 */
export type TaxOutcome = {
  taxableCents: number
  taxCents: number
}

/** Rates arrive in basis points, the way the existing invoice builder takes them. */
export const BPS_DIVISOR = 10_000

/**
 * A rate has to be a real number and cannot be negative. A negative rate
 * would turn tax into a discount, which is a data fault rather than a
 * pricing decision anybody made.
 */
function assertRate(taxBps: number) {
  if (!Number.isFinite(taxBps) || taxBps < 0) {
    throw new Error('taxBps must be a non-negative number')
  }
}

/**
 * Tax lands on what a client actually pays. Prepaid balances are money the
 * client already handed over, so they come off the bill first and the rate
 * bites on whatever is still owed after that. A cycle a balance clears
 * outright carries no tax at all, which is why the line is dropped rather
 * than written as zero.
 */
export function taxOnOwed(owedCents: number, taxBps: number): TaxOutcome {
  assertRate(taxBps)
  const taxable = Math.max(0, owedCents)
  if (taxable === 0 || taxBps === 0) {
    return { taxableCents: taxable, taxCents: 0 }
  }
  return {
    taxableCents: taxable,
    taxCents: roundHalfEven((taxable * taxBps) / BPS_DIVISOR, 0),
  }
}
