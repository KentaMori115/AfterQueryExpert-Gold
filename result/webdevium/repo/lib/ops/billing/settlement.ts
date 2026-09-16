import {
  attributeUsage,
  overageCents,
  roundHours,
  spreadAllowance,
  unusedAllowanceHours,
  type AllowanceRow,
} from './allowance'
import { applyCredits, type SettlementCredit } from './credits'
import type { UsageEvent } from './ledger'
import { prorateCycle, type PlanChange } from './proration'
import { taxOnOwed } from './tax'
import {
  convertStatementLines,
  TAX_REF,
  type StatementLine,
} from '@/lib/ops/invoices/statement'

export type { SettlementCredit } from './credits'
export type { StatementLine } from '@/lib/ops/invoices/statement'

export type SettlementInput = {
  clientId: string
  cycleStart: number
  cycleEnd: number
  changes: PlanChange[]
  usage: UsageEvent[]
  credits: SettlementCredit[]
  taxBps: number
  planCurrency: string
  currency: string
  ratesCsv: string
}

/**
 * What one plan period contributed, in the currency the plan is priced in.
 * Hours are the figures a client would read off the page, so they are already
 * rounded; the exact values stay behind in the allowance ledger.
 */
export type StatementSegment = {
  planId: string
  start: number
  end: number
  hours: number
  allowanceHours: number
  carriedInHours: number
  overageHours: number
  spentAllowanceHours: number
  subscriptionCents: number
  overageCents: number
}

/**
 * A closed cycle: what each plan period drew, what it costs in the currency
 * the client pays in, and what is left on the prepaid balances.
 */
export type CycleStatement = {
  currency: string
  segments: StatementSegment[]
  lines: StatementLine[]
  subtotalCents: number
  creditsAppliedCents: number
  taxableCents: number
  taxCents: number
  totalCents: number
  credits: SettlementCredit[]
  unusedAllowanceHours: number
}

/**
 * A credit shows on the statement as money coming off, so the entry carries a
 * negative figure rather than a flag a reader has to interpret.
 */
function creditLine(creditId: string, cents: number): StatementLine {
  return { kind: 'credit', ref: creditId, cents: -cents }
}

/** The tax entry belongs to no plan and no balance, so it refs itself. */
function taxLine(cents: number): StatementLine {
  return { kind: 'tax', ref: TAX_REF, cents }
}

/**
 * Turn one settled period into the row a client reads. The exact hours stay
 * in the allowance ledger; what lands here is what the page will show.
 */
function reportSegment(row: AllowanceRow): StatementSegment {
  return {
    planId: row.segment.plan.id,
    start: row.segment.start,
    end: row.segment.end,
    hours: roundHours(row.hours),
    allowanceHours: roundHours(row.allowanceHours),
    carriedInHours: roundHours(row.carriedInHours),
    overageHours: roundHours(row.overageHours),
    spentAllowanceHours: roundHours(row.spentAllowanceHours),
    subscriptionCents: row.segment.cents,
    overageCents: overageCents(row),
  }
}

/**
 * The seat comes first, then whatever the period ran over by, so a reader
 * follows the cycle forwards rather than jumping between two blocks.
 */
function priceSegment(segment: StatementSegment): StatementLine[] {
  const lines: StatementLine[] = [
    { kind: 'subscription', ref: segment.planId, cents: segment.subscriptionCents },
  ]
  if (segment.overageCents > 0) {
    lines.push({ kind: 'overage', ref: segment.planId, cents: segment.overageCents })
  }
  return lines
}

function settleUsage(input: SettlementInput) {
  const cycle = prorateCycle(input.changes, input.cycleStart, input.cycleEnd)
  const hours = attributeUsage(cycle.segments, input.usage, input.clientId)
  return spreadAllowance(cycle.segments, hours)
}

/**
 * Close a billing cycle out period by period.
 *
 * The seat and the included hours both follow the plan that was live at the
 * time rather than the plan the client happens to be on when the invoice is
 * cut, which is the whole point: an upgrade halfway through a month should
 * not reprice the fortnight before it.
 */
export function settleCycle(input: SettlementInput): CycleStatement {
  const rows = settleUsage(input)
  const segments = rows.map(reportSegment)
  const priced = segments.flatMap(priceSegment)

  const converted = convertStatementLines(
    priced,
    input.planCurrency,
    input.currency,
    input.ratesCsv
  )

  const outcome = applyCredits(converted.subtotalCents, input.credits, input.cycleEnd)
  const tail: StatementLine[] = outcome.applications.map((application) =>
    creditLine(application.creditId, application.cents)
  )

  const tax = taxOnOwed(outcome.owedCents, input.taxBps)
  if (tax.taxCents > 0) {
    tail.push(taxLine(tax.taxCents))
  }

  return {
    currency: input.currency,
    segments,
    lines: [...converted.lines, ...tail],
    subtotalCents: converted.subtotalCents,
    creditsAppliedCents: outcome.appliedCents,
    taxableCents: tax.taxableCents,
    taxCents: tax.taxCents,
    totalCents: outcome.owedCents + tax.taxCents,
    credits: outcome.credits,
    unusedAllowanceHours: roundHours(unusedAllowanceHours(rows)),
  }
}
