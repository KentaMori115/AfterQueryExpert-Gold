import { centsFromHours, roundHalfEven } from './money'
import type { Plan } from './proration'
import { totalUsageByWindow } from './usage'
import type { UsageEvent } from './ledger'

/**
 * One plan period inside a billing cycle, exactly as prorateCycle reports it.
 * Nothing here recomputes the split or the subscription cents: the period is
 * taken as given so a statement and an invoice never disagree about what the
 * client was on and what the seat cost.
 */
export type CycleSegment = {
  plan: Plan
  start: number
  end: number
  ratio: number
  cents: number
}

/**
 * A period once usage has been attributed to it and the included-hour
 * allowance has been spent against that usage. Everything on this row is an
 * exact figure: rounding belongs to the statement, not to the running total,
 * or a long cycle would drift a hundredth at a time.
 */
export type AllowanceRow = {
  segment: CycleSegment
  hours: number
  allowanceHours: number
  carriedInHours: number
  overageHours: number
  spentAllowanceHours: number
  carryOutHours: number
}

/** Hours are quoted in hundredths, the way a timesheet records them. */
export const HOUR_SCALE = 2

export function roundHours(hours: number) {
  return roundHalfEven(hours, HOUR_SCALE)
}

/**
 * What a single period earned in its own right, before anything an earlier
 * period handed it. A plan that covered a third of the cycle earns a third of
 * its included hours, which is the same proportion the seat is billed at.
 */
export function earnedHours(segment: CycleSegment) {
  return segment.plan.includedHours * segment.ratio
}

/**
 * Spend one period's usage against the hours available to it and report what
 * moves on. Hours never travel backwards: a period that overran is settled
 * before the next period's allowance exists, so an overrun stands even when
 * the client ends the cycle with hours to spare.
 */
export function spendPeriod(
  segment: CycleSegment,
  hours: number,
  carriedIn: number
): AllowanceRow {
  const earned = earnedHours(segment)
  const available = earned + carriedIn
  const spent = Math.min(hours, available)

  return {
    segment,
    hours,
    allowanceHours: earned,
    carriedInHours: carriedIn,
    overageHours: hours - spent,
    spentAllowanceHours: spent,
    carryOutHours: available - spent,
  }
}

/**
 * Walk the cycle forwards, handing each period whatever the one before it
 * left on the table.
 */
export function spreadAllowance(
  segments: CycleSegment[],
  hoursBySegment: number[]
): AllowanceRow[] {
  const rows: AllowanceRow[] = []
  let carried = 0

  for (let index = 0; index < segments.length; index += 1) {
    const row = spendPeriod(segments[index], hoursBySegment[index] ?? 0, carried)
    rows.push(row)
    carried = row.carryOutHours
  }

  return rows
}

/** What the client paid for and did not use by the time the cycle closed. */
export function unusedAllowanceHours(rows: AllowanceRow[]) {
  if (rows.length === 0) return 0
  return rows[rows.length - 1].carryOutHours
}

/**
 * Overage is priced by the plan that was live while the hours were logged,
 * off the figure the statement shows rather than the raw float behind it, so
 * the arithmetic on the page is the arithmetic that was charged.
 */
export function overageCents(row: AllowanceRow) {
  const billable = roundHours(row.overageHours)
  return centsFromHours(billable, row.segment.plan.overageCentsPerHour)
}

/**
 * Total the hours each period has to answer for, using the period windows the
 * cycle split already fixed.
 */
export function attributeUsage(
  segments: CycleSegment[],
  usage: UsageEvent[],
  clientId: string
) {
  return totalUsageByWindow(
    segments.map((segment) => ({ start: segment.start, end: segment.end })),
    usage,
    clientId
  )
}
