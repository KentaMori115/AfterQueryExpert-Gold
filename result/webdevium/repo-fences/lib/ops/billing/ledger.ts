import { fromCents } from './money'
import { prorateCycle, type Plan, type PlanChange } from './proration'

export type UsageEvent = {
  id: string
  at: number
  hours: number
  clientId: string
}

export type Credit = {
  id: string
  cents: number
  remainingCents: number
}

export type InvoiceLine = {
  kind: 'subscription' | 'overage' | 'credit'
  description: string
  cents: number
}

export function applyCredits(totalCents: number, credits: Credit[]) {
  let remaining = totalCents
  const applied: Credit[] = credits.map((credit) => ({ ...credit }))
  const lines: InvoiceLine[] = []

  for (const credit of applied) {
    if (remaining <= 0) break
    const use = Math.min(credit.remainingCents, remaining)
    credit.remainingCents -= use
    remaining -= use
    lines.push({
      kind: 'credit',
      description: `Credit ${credit.id}`,
      cents: -use,
    })
  }

  return { remainingCents: remaining, credits: applied, lines }
}

export function buildInvoice(input: {
  clientId: string
  cycleStart: number
  cycleEnd: number
  changes: PlanChange[]
  usage: UsageEvent[]
  credits: Credit[]
  activePlan: Plan
}) {
  const cycle = prorateCycle(input.changes, input.cycleStart, input.cycleEnd)
  const hours = input.usage
    .filter(
      (event) =>
        event.clientId === input.clientId &&
        event.at >= input.cycleStart &&
        event.at < input.cycleEnd
    )
    .reduce((sum, event) => sum + event.hours, 0)

  const overageHours = Math.max(0, hours - cycle.includedHours)
  const overageRate = input.changes[input.changes.length - 1]?.plan.overageCentsPerHour
    ?? input.activePlan.overageCentsPerHour
  const overageCents = Math.round(overageHours * overageRate)

  const lines: InvoiceLine[] = [
    {
      kind: 'subscription',
      description: 'Prorated subscription',
      cents: cycle.subscriptionCents,
    },
  ]
  if (overageCents > 0) {
    lines.push({
      kind: 'overage',
      description: `${overageHours.toFixed(2)} overage hours`,
      cents: overageCents,
    })
  }

  const subtotal = lines.reduce((sum, line) => sum + line.cents, 0)
  const credited = applyCredits(subtotal, input.credits)

  return {
    lines: [...lines, ...credited.lines],
    hours,
    includedHours: cycle.includedHours,
    overageHours,
    subtotalCents: subtotal,
    totalCents: credited.remainingCents,
    total: fromCents(credited.remainingCents),
    credits: credited.credits,
    segments: cycle.segments,
  }
}
