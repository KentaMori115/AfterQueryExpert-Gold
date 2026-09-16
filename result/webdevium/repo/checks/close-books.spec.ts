import { describe, expect, it } from 'vitest'
import { settleCycle } from '@/lib/ops/billing/settlement'
import type { Plan } from '@/lib/ops/billing/proration'

const DAY = 86_400_000
const CYCLE_END = 30 * DAY
const CHANGE_AT = 13 * DAY

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
const flat: Plan = {
  id: 'flat',
  monthlyCents: 30_000,
  includedHours: 20,
  overageCentsPerHour: 1250,
}

const RATES = ['# pair,rate', 'USDEUR,0.885', 'GBPUSD,1.25'].join('\n')

const hours = (id: string, atDays: number, count: number, clientId = 'c1') => ({
  id,
  at: atDays * DAY,
  hours: count,
  clientId,
})

const upgrade = (over: Record<string, unknown> = {}) =>
  settleCycle({
    clientId: 'c1',
    cycleStart: 0,
    cycleEnd: CYCLE_END,
    changes: [
      { at: 0, plan: starter },
      { at: CHANGE_AT, plan: growth },
    ],
    usage: [],
    credits: [],
    taxBps: 0,
    planCurrency: 'USD',
    currency: 'USD',
    ratesCsv: RATES,
    ...(over as object),
  } as Parameters<typeof settleCycle>[0])

const single = (over: Record<string, unknown> = {}) =>
  settleCycle({
    clientId: 'c1',
    cycleStart: 0,
    cycleEnd: CYCLE_END,
    changes: [{ at: 0, plan: flat }],
    usage: [],
    credits: [],
    taxBps: 0,
    planCurrency: 'USD',
    currency: 'USD',
    ratesCsv: RATES,
    ...(over as object),
  } as Parameters<typeof settleCycle>[0])

describe('closing a cycle that upgraded', () => {
  it('upgrade at day 13 splits into starter then growth', () => {
    const statement = upgrade()
    expect(statement.segments).toHaveLength(2)
    expect(statement.segments.map((segment) => segment.planId)).toEqual(['starter', 'growth'])
    expect(statement.segments[0].subscriptionCents).toBe(4333)
    expect(statement.segments[1].subscriptionCents).toBe(11333)
  })

  it('a 13 day starter stretch is worth 4.33 of its 10 hours', () => {
    const statement = upgrade()
    expect(statement.segments[0].allowanceHours).toBe(4.33)
    expect(statement.segments[1].allowanceHours).toBe(11.33)
  })

  it('five hours booked on changeover day land on growth', () => {
    const statement = upgrade({
      usage: [hours('a', 13, 5), hours('b', 2, 3)],
    })
    expect(statement.segments[0].hours).toBe(3)
    expect(statement.segments[1].hours).toBe(5)
  })

  it('another client, a later month and a prior week all miss', () => {
    const statement = upgrade({
      usage: [hours('a', 2, 3), hours('far', 40, 99), hours('early', -1, 4), hours('them', 5, 50, 'other')],
    })
    expect(statement.segments[0].hours).toBe(3)
    expect(statement.segments[1].hours).toBe(0)
  })

  it('a redelivered event does not double the hours', () => {
    const statement = upgrade({
      usage: [hours('a', 2, 6), hours('a', 20, 100), hours('b', 20, 2)],
    })
    expect(statement.segments[0].hours).toBe(6)
    expect(statement.segments[1].hours).toBe(2)
  })

  it('minus one hour blows up rather than crediting', () => {
    expect(() => upgrade({ usage: [hours('a', 2, -1)] })).toThrow()
  })
})

describe('hours carried between periods', () => {
  it('one hour used out of 4.33 leaves 3.33 for growth', () => {
    const statement = upgrade({ usage: [hours('a', 2, 1), hours('b', 20, 14)] })
    expect(statement.segments[0].carriedInHours).toBe(0)
    expect(statement.segments[1].carriedInHours).toBe(3.33)
    expect(statement.segments[1].overageHours).toBe(0)
  })

  it('nine hours in week one still overruns on a quiet month', () => {
    const statement = upgrade({ usage: [hours('a', 2, 9), hours('b', 20, 2)] })
    expect(statement.segments[0].overageHours).toBe(4.67)
    expect(statement.segments[1].carriedInHours).toBe(0)
    expect(statement.segments[1].overageHours).toBe(0)
  })

  it('a light month closes 0.67 hours to the good', () => {
    const statement = upgrade({ usage: [hours('a', 2, 1), hours('b', 20, 14)] })
    expect(statement.unusedAllowanceHours).toBe(0.67)
  })

  it('an idle client closes holding 15.67', () => {
    expect(upgrade().unusedAllowanceHours).toBe(15.67)
  })
})

describe('what an overrun costs', () => {
  it('starter overrun costs 1500 an hour, growth 1200', () => {
    const statement = upgrade({ usage: [hours('a', 2, 9), hours('b', 20, 14)] })
    expect(statement.segments[0].overageCents).toBe(7005)
    expect(statement.segments[1].overageCents).toBe(3204)
  })

  it('3.125 hours over becomes 3.12', () => {
    const statement = single({ usage: [hours('a', 5, 23.125)] })
    expect(statement.segments[0].overageHours).toBe(3.12)
  })

  it('3.375 hours over becomes 3.38', () => {
    const statement = single({ usage: [hours('a', 5, 23.375)] })
    expect(statement.segments[0].overageHours).toBe(3.38)
  })

  it('3.25 hours at 1250 comes to 4062', () => {
    const statement = single({ usage: [hours('a', 5, 23.25)] })
    expect(statement.segments[0].overageCents).toBe(4062)
  })

  it('3.75 hours at 1250 comes to 4688', () => {
    const statement = single({ usage: [hours('a', 5, 23.75)] })
    expect(statement.segments[0].overageCents).toBe(4688)
  })

  it('twelve hours on a twenty hour plan bills nothing extra', () => {
    const statement = single({ usage: [hours('a', 5, 12)] })
    expect(statement.segments[0].overageCents).toBe(0)
    expect(statement.lines.filter((line) => line.kind === 'overage')).toHaveLength(0)
  })
})

describe('statement entries', () => {
  it('four entries come out of a two period cycle', () => {
    const statement = upgrade({ usage: [hours('a', 2, 9), hours('b', 20, 14)] })
    expect(statement.lines.map((line) => [line.kind, line.ref, line.cents])).toEqual([
      ['subscription', 'starter', 4333],
      ['overage', 'starter', 7005],
      ['subscription', 'growth', 11333],
      ['overage', 'growth', 3204],
    ])
    expect(statement.subtotalCents).toBe(25875)
  })
})

describe('billing in another currency', () => {
  const used = [hours('a', 2, 9), hours('b', 20, 14)]

  it('a 0.885 rate moves 4333 to 3835', () => {
    const statement = upgrade({ usage: used, currency: 'EUR' })
    expect(statement.lines[0].cents).toBe(3835)
    expect(statement.lines[1].cents).toBe(6199)
    expect(statement.lines[3].cents).toBe(2836)
  })

  it('a stray cent comes off growth subscription, nothing else', () => {
    const statement = upgrade({ usage: used, currency: 'EUR' })
    expect(statement.subtotalCents).toBe(22899)
    expect(statement.lines[2].cents).toBe(10029)
    expect(statement.lines.reduce((sum, line) => sum + line.cents, 0)).toBe(22899)
  })

  it('a USD plan billed in USD is untouched', () => {
    const statement = upgrade({ usage: used })
    expect(statement.subtotalCents).toBe(25875)
  })

  it('periods still read 4333 while entries read euros', () => {
    const statement = upgrade({ usage: used, currency: 'EUR' })
    expect(statement.segments[0].subscriptionCents).toBe(4333)
    expect(statement.segments[1].overageCents).toBe(3204)
  })
})

describe('drawing on prepaid balances', () => {
  const used = [hours('a', 2, 9), hours('b', 20, 14)]
  const balances = [
    { id: 'z-open', remainingCents: 5_000, expiresAt: null },
    { id: 'b-soon', remainingCents: 1_200, expiresAt: 31 * DAY },
    { id: 'a-soon', remainingCents: 1_200, expiresAt: 31 * DAY },
    { id: 'lapsed', remainingCents: 9_000, expiresAt: 29 * DAY },
    { id: 'later', remainingCents: 400, expiresAt: 90 * DAY },
  ]

  it('four live balances come out a-soon, b-soon, later, z-open', () => {
    const statement = upgrade({ usage: used, credits: balances })
    expect(
      statement.lines.filter((line) => line.kind === 'credit').map((line) => line.ref)
    ).toEqual(['a-soon', 'b-soon', 'later', 'z-open'])
  })

  it('a balance dated day 29 is untouched on a day 30 close', () => {
    const statement = upgrade({ usage: used, credits: balances })
    expect(statement.creditsAppliedCents).toBe(7800)
    expect(statement.credits.find((credit) => credit.id === 'lapsed')?.remainingCents).toBe(9_000)
  })

  it('five balances come back in caller order', () => {
    const statement = upgrade({ usage: used, credits: balances })
    expect(statement.credits.map((credit) => credit.id)).toEqual([
      'z-open',
      'b-soon',
      'a-soon',
      'lapsed',
      'later',
    ])
  })

  it('7800 drawn brings 25875 down to 18075', () => {
    const statement = upgrade({ usage: used, credits: balances })
    expect(statement.lines.filter((line) => line.kind === 'credit').map((line) => line.cents)).toEqual(
      [-1200, -1200, -400, -5000]
    )
    expect(statement.totalCents).toBe(18_075)
  })

  it('a 40000 balance parts with 25875 and keeps 14125', () => {
    const statement = upgrade({
      usage: used,
      credits: [{ id: 'big', remainingCents: 40_000, expiresAt: null }],
    })
    expect(statement.creditsAppliedCents).toBe(25_875)
    expect(statement.totalCents).toBe(0)
    expect(statement.credits[0].remainingCents).toBe(14_125)
  })
})

describe('what tax is charged on', () => {
  const used = [hours('a', 2, 9), hours('b', 20, 14)]

  it('2000 bps on 15875 is 3175, not on the whole bill', () => {
    const statement = upgrade({
      usage: used,
      taxBps: 2000,
      credits: [{ id: 'c1', remainingCents: 10_000, expiresAt: null }],
    })
    expect(statement.taxCents).toBe(3_175)
    expect(statement.totalCents).toBe(19_050)
  })

  it('a balance that clears the bill leaves no tax entry', () => {
    const statement = upgrade({
      usage: used,
      taxBps: 2000,
      credits: [{ id: 'c1', remainingCents: 90_000, expiresAt: null }],
    })
    expect(statement.taxCents).toBe(0)
    expect(statement.totalCents).toBe(0)
    expect(statement.lines.filter((line) => line.kind === 'tax')).toHaveLength(0)
  })

  it('a single plan month ends 30000, 4375, 3438', () => {
    const statement = single({ usage: [hours('a', 5, 23.5)], taxBps: 1000 })
    expect(statement.lines[statement.lines.length - 1]).toMatchObject({ kind: 'tax', cents: 3438 })
    expect(statement.totalCents).toBe(37_813)
  })

  it('a half cent of tax lands on 3436 from above and from below', () => {
    const heavier = single({
      usage: [hours('a', 5, 23.5)],
      taxBps: 1000,
      credits: [{ id: 'tiny', remainingCents: 10, expiresAt: null }],
    })
    expect(heavier.creditsAppliedCents).toBe(10)
    expect(heavier.taxCents).toBe(3436)
    expect(heavier.totalCents).toBe(37_801)

    const lighter = single({
      usage: [hours('a', 5, 23.5)],
      taxBps: 1000,
      credits: [{ id: 'tiny', remainingCents: 20, expiresAt: null }],
    })
    expect(lighter.creditsAppliedCents).toBe(20)
    expect(lighter.taxCents).toBe(3436)
    expect(lighter.totalCents).toBe(37_791)
  })
})

describe('end of the statement', () => {
  const used = [hours('a', 2, 9), hours('b', 20, 14)]

  it('two balances then tax, in that order', () => {
    const statement = upgrade({
      usage: used,
      taxBps: 1500,
      credits: [
        { id: 'first', remainingCents: 4_000, expiresAt: 40 * DAY },
        { id: 'second', remainingCents: 3_000, expiresAt: null },
      ],
    })
    expect(statement.lines.slice(-3).map((line) => line.kind)).toEqual([
      'credit',
      'credit',
      'tax',
    ])
    expect(statement.lines.slice(-3, -1).map((line) => line.ref)).toEqual(['first', 'second'])
    expect(statement.taxCents).toBe(2_831)
    expect(statement.totalCents).toBe(21_706)
  })
})

describe('a month with two plan changes', () => {
  const downgrade = (over: Record<string, unknown> = {}) =>
    settleCycle({
      clientId: 'c1',
      cycleStart: 0,
      cycleEnd: CYCLE_END,
      changes: [
        { at: 0, plan: starter },
        { at: 10 * DAY, plan: growth },
        { at: 22 * DAY, plan: starter },
      ],
      usage: [],
      credits: [],
      taxBps: 0,
      planCurrency: 'USD',
      currency: 'USD',
      ratesCsv: RATES,
      ...(over as object),
    } as Parameters<typeof settleCycle>[0])

  it('starter, growth, starter across one month', () => {
    const statement = downgrade()
    expect(statement.segments.map((segment) => segment.planId)).toEqual([
      'starter',
      'growth',
      'starter',
    ])
    expect(statement.segments.map((segment) => segment.subscriptionCents)).toEqual([
      3333, 8000, 2667,
    ])
  })

  it('three periods earn 3.33, 8 and 2.67', () => {
    const statement = downgrade()
    expect(statement.segments.map((segment) => segment.allowanceHours)).toEqual([
      3.33, 8, 2.67,
    ])
  })

  it('one spare hour reaches the middle period', () => {
    const statement = downgrade({
      usage: [hours('a', 2, 1), hours('b', 15, 12), hours('c', 25, 1)],
    })
    expect(statement.segments.map((segment) => segment.carriedInHours)).toEqual([0, 2.33, 0])
    expect(statement.segments.map((segment) => segment.overageHours)).toEqual([0, 1.67, 0])
    expect(statement.unusedAllowanceHours).toBe(1.67)
  })

  it('same client, three overruns, two different rates', () => {
    const statement = downgrade({
      usage: [hours('a', 2, 9), hours('b', 15, 12), hours('c', 25, 6)],
    })
    expect(statement.segments.map((segment) => segment.overageCents)).toEqual([8505, 4800, 4995])
  })

  it('six entries in cycle order', () => {
    const statement = downgrade({
      usage: [hours('a', 2, 9), hours('b', 15, 12), hours('c', 25, 6)],
    })
    expect(statement.lines.map((line) => `${line.kind}:${line.ref}`)).toEqual([
      'subscription:starter',
      'overage:starter',
      'subscription:growth',
      'overage:growth',
      'subscription:starter',
      'overage:starter',
    ])
    expect(statement.subtotalCents).toBe(32_300)
  })
})

describe('work on the cycle boundary', () => {
  it('work at the opening instant is inside', () => {
    const statement = upgrade({ usage: [hours('a', 0, 4)] })
    expect(statement.segments[0].hours).toBe(4)
  })

  it('work at the closing instant is outside', () => {
    const statement = upgrade({ usage: [hours('a', 30, 4)] })
    expect(statement.segments[0].hours).toBe(0)
    expect(statement.segments[1].hours).toBe(0)
  })
})

describe('which balance goes first', () => {
  const used = [hours('a', 2, 9), hours('b', 20, 14)]
  const draw = (credits: unknown[]) =>
    upgrade({ usage: used, credits }).lines
      .filter((line) => line.kind === 'credit')
      .map((line) => line.ref)

  it('day 40 goes before day 90', () => {
    expect(
      draw([
        { id: 'late', remainingCents: 500, expiresAt: 90 * DAY },
        { id: 'soon', remainingCents: 500, expiresAt: 40 * DAY },
      ])
    ).toEqual(['soon', 'late'])
  })

  it('undated waits for day 200', () => {
    expect(
      draw([
        { id: 'open', remainingCents: 500, expiresAt: null },
        { id: 'dated', remainingCents: 500, expiresAt: 200 * DAY },
      ])
    ).toEqual(['dated', 'open'])
  })

  it('200 goes before 900 on the same date', () => {
    expect(
      draw([
        { id: 'big', remainingCents: 900, expiresAt: 40 * DAY },
        { id: 'small', remainingCents: 200, expiresAt: 40 * DAY },
      ])
    ).toEqual(['small', 'big'])
  })

  it('alpha before zeta on a dead heat', () => {
    expect(
      draw([
        { id: 'zeta', remainingCents: 300, expiresAt: 40 * DAY },
        { id: 'alpha', remainingCents: 300, expiresAt: 40 * DAY },
      ])
    ).toEqual(['alpha', 'zeta'])
  })

  it('no balances at all, bill stands at 25875', () => {
    const statement = upgrade({ usage: used, credits: [] })
    expect(statement.creditsAppliedCents).toBe(0)
    expect(statement.totalCents).toBe(25_875)
    expect(statement.credits).toEqual([])
  })
})

describe('a plan priced in sterling', () => {
  const used = [hours('a', 2, 9), hours('b', 20, 14)]

  it('GBP priced plan billed in USD', () => {
    const statement = upgrade({ usage: used, planCurrency: 'GBP', currency: 'USD' })
    expect(statement.lines.map((line) => line.cents)).toEqual([5416, 8756, 14167, 4005])
    expect(statement.subtotalCents).toBe(32_344)
  })

  it('entries still total the subtotal after that', () => {
    const statement = upgrade({ usage: used, planCurrency: 'GBP', currency: 'USD' })
    const total = statement.lines.reduce((sum, line) => sum + line.cents, 0)
    expect(total).toBe(statement.subtotalCents)
  })
})
