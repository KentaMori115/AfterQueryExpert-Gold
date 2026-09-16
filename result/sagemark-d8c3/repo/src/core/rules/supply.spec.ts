import { describe, expect, it } from 'vitest'

import type { RandomSource } from '../dice/roll'
import type { CalendarDay, CalendarShape } from '../lib/inworld-calendar'

import { planJourney } from './journey'
import { type SupplyState, drawRations } from './supply'
import type { Climate, Season, TravelPace } from './weather'

const shape: CalendarShape = { monthsPerYear: 12, daysPerMonth: 30 }
const start: CalendarDay = { year: 812, month: 3, day: 27 }

// The weather table is weighted, so a fixed draw picks a known row: 0 is the
// first row for a climate and season, 0.999 the last.
function rngFrom(values: ReadonlyArray<number>): RandomSource {
  let i = 0
  return () => values[Math.min(i++, values.length - 1)] ?? 0
}

const clear = 0
const worst = 0.999

interface Leg {
  name: string
  miles: number
  costPerMile: number
  climate: Climate
  season: Season
  pace: TravelPace
}

interface Party {
  size: number
  milesPerDay: number
  rations: number
  exhaustion: number
}

function leg(over: Partial<Leg> = {}): Leg {
  return {
    name: 'River road',
    miles: 500,
    costPerMile: 1,
    climate: 'temperate',
    season: 'summer',
    pace: 'normal',
    ...over,
  }
}

function party(over: Partial<Party> = {}): Party {
  return { size: 4, milesPerDay: 20, rations: 40, exhaustion: 0, ...over }
}

function walk(legs: ReadonlyArray<Leg>, over: Partial<Party> = {}, draws = [clear]) {
  return planJourney({
    legs,
    party: party(over),
    start,
    calendar: shape,
    rng: rngFrom(draws),
  })
}

function packs(rations: number, hungryDays = 0): SupplyState {
  return { rations, hungryDays }
}

describe('drawRations', () => {
  it('feeds one ration to every mouth', () => {
    const drawn = drawRations(packs(10), 4)
    expect(drawn.drawn).toBe(4)
    expect(drawn.short).toBe(0)
    expect(drawn.state.rations).toBe(6)
    expect(drawn.state.hungryDays).toBe(0)
  })

  it('hands back a new ledger and leaves the old one alone', () => {
    const before = packs(10)
    const drawn = drawRations(before, 4)
    expect(before.rations).toBe(10)
    expect(drawn.state).not.toBe(before)
  })

  it('gives what the packs hold and reports the mouths it could not cover', () => {
    const drawn = drawRations(packs(2), 5)
    expect(drawn.drawn).toBe(2)
    expect(drawn.short).toBe(3)
    expect(drawn.state.rations).toBe(0)
  })

  it('empties the packs on the evening they exactly cover the party', () => {
    const drawn = drawRations(packs(4), 4)
    expect(drawn.drawn).toBe(4)
    expect(drawn.short).toBe(0)
    expect(drawn.state.rations).toBe(0)
    expect(drawn.state.hungryDays).toBe(0)
  })

  it('counts a short evening as one hungry day, not one per empty stomach', () => {
    const drawn = drawRations(packs(1), 6)
    expect(drawn.short).toBe(5)
    expect(drawn.state.hungryDays).toBe(1)
  })

  it('adds hungry days up as they come', () => {
    const first = drawRations(packs(0), 3)
    const second = drawRations(first.state, 3)
    expect(second.state.hungryDays).toBe(2)
  })

  it('takes nothing for nobody, and calls it no hungry day', () => {
    const drawn = drawRations(packs(10), 0)
    expect(drawn.drawn).toBe(0)
    expect(drawn.short).toBe(0)
    expect(drawn.state.rations).toBe(10)
    expect(drawn.state.hungryDays).toBe(0)
  })

  it('leaves the packs at zero rather than in debt', () => {
    const drawn = drawRations(packs(0), 4)
    expect(drawn.state.rations).toBe(0)
    expect(drawn.short).toBe(4)
  })
})

describe('a journey eats', () => {
  it('draws one ration a head every day', () => {
    const report = walk([leg({ miles: 100 })])
    expect(report.days.map((d) => d.rationsLeft)).toEqual([36, 32, 28, 24, 20])
    expect(report.rationsLeft).toBe(20)
    expect(report.hungryDays).toBe(0)
  })

  it('marks nobody hungry while the packs hold out', () => {
    const report = walk([leg({ miles: 100 })])
    expect(report.days.every((d) => !d.hungry)).toBe(true)
  })

  it('goes hungry the evening the packs cannot cover everyone', () => {
    const report = walk([leg()], { rations: 6 })
    expect(report.days[0]!.hungry).toBe(false)
    expect(report.days[1]!.hungry).toBe(true)
    expect(report.days[1]!.rationsLeft).toBe(0)
  })

  it('costs a level of exhaustion for every hungry evening', () => {
    const report = walk([leg()], { rations: 6 })
    expect(report.days.map((d) => d.exhaustion)).toEqual([0, 1, 2, 3, 4, 5, 6])
  })

  it('runs the party into the ground on an empty pack', () => {
    const report = walk([leg()], { rations: 6 })
    expect(report.days).toHaveLength(7)
    expect(report.stalled).toBe(true)
    expect(report.milesLeft).toBe(410)
    expect(report.hungryDays).toBe(6)
  })

  it('walks the hungry days at the speed the party still has', () => {
    const report = walk([leg()], { rations: 6 })
    expect(report.days.map((d) => d.covered)).toEqual([20, 20, 20, 10, 10, 10, 0])
  })

  it('takes both levels when a forced march ends on an empty pack', () => {
    const report = walk([leg({ miles: 300, pace: 'forced' })], { size: 2, rations: 0 })
    expect(report.days.map((d) => d.exhaustion)).toEqual([2, 4, 6, 6])
    expect(report.days.map((d) => d.covered)).toEqual([30, 15, 15, 0])
    expect(report.stalled).toBe(true)
  })

  it('spoils one more ration on a severe day', () => {
    const report = walk([leg({ miles: 100 })], { size: 3, rations: 10 }, [worst])
    expect(report.days[0]!.severity).toBe('severe')
    expect(report.days[0]!.rationsLeft).toBe(6)
    expect(report.days[1]!.rationsLeft).toBe(2)
  })

  it('cannot spoil what the packs no longer hold', () => {
    const report = walk([leg({ miles: 100 })], { size: 3, rations: 10 }, [worst])
    expect(report.days[2]!.rationsLeft).toBe(0)
    expect(report.days[2]!.hungry).toBe(true)
  })

  it('leaves the packs alone on a day nobody is walking anywhere', () => {
    const report = walk([], { rations: 12 })
    expect(report.rationsLeft).toBe(12)
    expect(report.hungryDays).toBe(0)
  })

  it('feeds nobody when nobody is walking', () => {
    const report = walk([leg({ miles: 40 })], { size: 0, rations: 9 })
    expect(report.days.every((d) => d.rationsLeft === 9)).toBe(true)
    expect(report.hungryDays).toBe(0)
    expect(report.days.every((d) => !d.hungry)).toBe(true)
  })

  it('keeps counting hungry days after the packs are long empty', () => {
    const report = walk([leg({ miles: 300, pace: 'forced' })], { size: 2, rations: 0 })
    expect(report.hungryDays).toBe(report.days.length)
  })

  it('eats faster with more mouths at the fire', () => {
    const report = walk([leg()], { size: 6, rations: 12 })
    expect(report.days.slice(0, 3).map((d) => d.rationsLeft)).toEqual([6, 0, 0])
    expect(report.days.slice(0, 3).map((d) => d.hungry)).toEqual([false, false, true])
  })

  it('opens the ledger on what the party set out carrying', () => {
    const report = walk([leg({ miles: 20 })], { size: 5, rations: 33 })
    expect(report.days).toHaveLength(1)
    expect(report.rationsLeft).toBe(28)
  })
})
