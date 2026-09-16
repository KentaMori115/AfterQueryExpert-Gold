import { describe, expect, it } from 'vitest'
import { buildInvoice } from '@/lib/ops/billing/ledger'
import { cents, fromCents, roundHalfEven } from '@/lib/ops/billing/money'
import { prorateCycle, type Plan } from '@/lib/ops/billing/proration'
import { buildFxInvoice } from '@/lib/ops/invoices/builder'
import { convertAmount, lookupRate, parseRateTable } from '@/lib/ops/invoices/fx.js'

const DAY = 86_400_000

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

describe('existing cycle proration', () => {
  it('drops a plan that never covered any of the cycle', () => {
    const cycle = prorateCycle(
      [
        { at: 0, plan: starter },
        { at: 30 * DAY, plan: growth },
      ],
      0,
      30 * DAY
    )
    expect(cycle.segments).toHaveLength(1)
    expect(cycle.subscriptionCents).toBe(10_000)
  })

  it('clamps a plan that started before the cycle opened', () => {
    const cycle = prorateCycle([{ at: -5 * DAY, plan: growth }], 0, 30 * DAY)
    expect(cycle.segments[0].start).toBe(0)
    expect(cycle.segments[0].ratio).toBe(1)
  })

  it('refuses a cycle with nothing on it or with no length', () => {
    expect(() => prorateCycle([], 0, 30 * DAY)).toThrow()
    expect(() => prorateCycle([{ at: 0, plan: growth }], 30 * DAY, 0)).toThrow()
  })
})

describe('existing rounding helpers', () => {
  it('sends a half to the even neighbour on both sides', () => {
    expect(roundHalfEven(2.345, 2)).toBe(2.34)
    expect(roundHalfEven(2.355, 2)).toBe(2.36)
  })

  it('keeps a value that is nowhere near a half where it is', () => {
    expect(roundHalfEven(7.201, 2)).toBe(7.2)
    expect(cents(12.344)).toBe(1234)
    expect(fromCents(1234)).toBe(12.34)
  })
})

describe('existing rate table reader', () => {
  const table = ['# pair,rate', '', 'EURUSD,1.10', 'GBPUSD,1.25'].join('\n')

  it('skips comments and blank rows, and refuses a malformed one', () => {
    expect(parseRateTable(table).EURUSD).toBe(1.1)
    expect(() => parseRateTable('EURO,1')).toThrow(/Invalid rate row/)
  })

  it('reads a pair forwards, backwards, and against itself', () => {
    const rates = parseRateTable(table)
    expect(lookupRate(rates, 'USD', 'USD')).toBe(1)
    expect(lookupRate(rates, 'EUR', 'USD')).toBe(1.1)
    expect(lookupRate(rates, 'USD', 'GBP')).toBe(1 / 1.25)
    expect(() => lookupRate(rates, 'JPY', 'USD')).toThrow(/No FX rate/)
  })

  it('converts at whole-cent scale with the half going to the even neighbour', () => {
    expect(convertAmount(4062.5, 1, 0)).toBe(4062)
    expect(convertAmount(4687.5, 1, 0)).toBe(4688)
  })
})

describe('existing invoice credit handling', () => {
  it('draws balances down in the order the caller listed them', () => {
    const invoice = buildInvoice({
      clientId: 'c1',
      cycleStart: 0,
      cycleEnd: 30 * DAY,
      changes: [{ at: 0, plan: growth }],
      usage: [{ id: 'u1', at: 2 * DAY, hours: 25, clientId: 'c1' }],
      credits: [
        { id: 'first', cents: 1_000, remainingCents: 1_000 },
        { id: 'second', cents: 50_000, remainingCents: 50_000 },
      ],
      activePlan: growth,
    })
    expect(invoice.credits[0].remainingCents).toBe(0)
    expect(invoice.credits[1].remainingCents).toBe(25_000)
    expect(invoice.totalCents).toBe(0)
  })
})

describe('existing invoice builders', () => {
  it('pools included hours across the whole cycle and charges the latest rate', () => {
    const invoice = buildInvoice({
      clientId: 'c1',
      cycleStart: 0,
      cycleEnd: 30 * DAY,
      changes: [
        { at: 0, plan: starter },
        { at: 15 * DAY, plan: growth },
      ],
      usage: [{ id: 'u1', at: 2 * DAY, hours: 20, clientId: 'c1' }],
      credits: [],
      activePlan: growth,
    })
    expect(invoice.overageHours).toBeCloseTo(5)
    expect(invoice.subtotalCents).toBe(21_000)
  })

  it('taxes the whole subtotal rather than what is left after a credit', () => {
    const invoice = buildFxInvoice({
      items: [{ description: 'Design', quantity: 2, unitCents: 10_000, currency: 'EUR' }],
      currency: 'USD',
      taxBps: 1000,
      ratesCsv: 'EURUSD,1.10',
    })
    expect(invoice.subtotalCents).toBe(22_000)
    expect(invoice.taxCents).toBe(2_200)
    expect(invoice.totalCents).toBe(24_200)
  })
})

describe('existing change ordering', () => {
  it('orders plan changes by when they happened, not by how they were listed', () => {
    const cycle = prorateCycle(
      [
        { at: 20 * DAY, plan: growth },
        { at: 0, plan: starter },
      ],
      0,
      30 * DAY
    )
    expect(cycle.segments.map((segment) => segment.plan.id)).toEqual(['starter', 'growth'])
    expect(cycle.segments[0].ratio).toBeCloseTo(2 / 3)
  })

  it('adds the included hours up across the periods it produced', () => {
    const cycle = prorateCycle(
      [
        { at: 0, plan: starter },
        { at: 15 * DAY, plan: growth },
      ],
      0,
      30 * DAY
    )
    expect(cycle.includedHours).toBeCloseTo(15)
  })
})
