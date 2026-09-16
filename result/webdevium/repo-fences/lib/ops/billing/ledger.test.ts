import { describe, expect, it } from 'vitest'
import { buildInvoice } from './ledger'
import { roundHalfEven } from './money'
import { prorateCycle, type Plan } from './proration'

const starter: Plan = {
  id: 'starter',
  monthlyCents: 10_000,
  includedHours: 10,
  overageCentsPerHour: 1500,
}
const growth: Plan = {
  id: 'growth',
  monthlyCents: 20_000,
  includedHours: 20,
  overageCentsPerHour: 1200,
}

describe('prorateCycle', () => {
  it('splits a mid-cycle upgrade by exact elapsed ratio', () => {
    const cycle = prorateCycle(
      [
        { at: 0, plan: starter },
        { at: 15, plan: growth },
      ],
      0,
      30
    )
    expect(cycle.segments).toHaveLength(2)
    expect(cycle.segments[0].cents).toBe(5_000)
    expect(cycle.segments[1].cents).toBe(10_000)
    expect(cycle.subscriptionCents).toBe(15_000)
    expect(cycle.includedHours).toBeCloseTo(15)
  })
})

describe('buildInvoice', () => {
  it('charges overage only after prorated included hours and applies credits FIFO', () => {
    const invoice = buildInvoice({
      clientId: 'c1',
      cycleStart: 0,
      cycleEnd: 30,
      changes: [
        { at: 0, plan: starter },
        { at: 15, plan: growth },
      ],
      usage: [
        { id: 'u1', at: 4, hours: 12, clientId: 'c1' },
        { id: 'u2', at: 20, hours: 8, clientId: 'c1' },
        { id: 'u3', at: 8, hours: 50, clientId: 'other' },
      ],
      credits: [
        { id: 'cr-old', cents: 2_000, remainingCents: 2_000 },
        { id: 'cr-new', cents: 50_000, remainingCents: 50_000 },
      ],
      activePlan: growth,
    })

    expect(invoice.hours).toBe(20)
    expect(invoice.overageHours).toBeCloseTo(5)
    expect(invoice.subtotalCents).toBe(15_000 + 6_000)
    expect(invoice.credits[0].remainingCents).toBe(0)
    expect(invoice.credits[1].remainingCents).toBe(31_000)
    expect(invoice.totalCents).toBe(0)
    expect(invoice.lines.some((line) => line.kind === 'credit' && line.cents === -2_000)).toBe(true)
  })
})

describe('roundHalfEven', () => {
  it('rounds .5 toward the even neighbor', () => {
    expect(roundHalfEven(1.225, 2)).toBe(1.22)
    expect(roundHalfEven(1.235, 2)).toBe(1.24)
  })
})
