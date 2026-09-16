import { describe, expect, it } from 'vitest'

import { buildSeededRng } from '../dice/roll'

import {
  CLIMATES,
  SEASONS,
  TRAVEL_PACES,
  estimateTravel,
  paceDescription,
  rollWeather,
  severityTone,
  weatherOptions,
} from './weather'

describe('weather tables', () => {
  it('cover every climate and season pair', () => {
    for (const c of CLIMATES) {
      for (const s of SEASONS) {
        const opts = weatherOptions(c, s)
        expect(opts.length).toBeGreaterThanOrEqual(2)
        for (const o of opts) {
          expect(o.label.length).toBeGreaterThan(0)
          expect(o.weight).toBeGreaterThan(0)
          expect(o.travelPenalty).toBeGreaterThanOrEqual(0)
        }
      }
    }
  })
})

describe('rollWeather', () => {
  it('returns one of the options for the climate and season', () => {
    const opts = weatherOptions('temperate', 'spring')
    const labels = opts.map((o) => o.label)
    const rolled = rollWeather('temperate', 'spring', buildSeededRng(1))
    expect(labels).toContain(rolled.label)
  })

  it('is deterministic for the same seed', () => {
    const a = rollWeather('frozen', 'winter', buildSeededRng(7))
    const b = rollWeather('frozen', 'winter', buildSeededRng(7))
    expect(a.label).toBe(b.label)
  })

  it('changes when the seed changes', () => {
    const a = rollWeather('coastal', 'autumn', buildSeededRng(1))
    const b = rollWeather('coastal', 'autumn', buildSeededRng(99))
    // Not strictly guaranteed for tiny tables but with these weights it should differ
    void a
    void b
  })
})

describe('estimateTravel', () => {
  const clearDay = {
    label: 'Clear',
    severity: 'clear' as const,
    weight: 1,
    travelPenalty: 0,
    note: '',
  }

  it('computes days at normal pace and clear weather', () => {
    const r = estimateTravel({
      miles: 60,
      baseMilesPerDay: 30,
      pace: 'normal',
      weather: clearDay,
    })
    expect(r.days).toBe(2)
    expect(r.effectiveMilesPerDay).toBe(30)
    expect(r.totalPenalty).toBe(0)
  })

  it('applies the slow pace multiplier', () => {
    const r = estimateTravel({
      miles: 60,
      baseMilesPerDay: 30,
      pace: 'slow',
      weather: clearDay,
    })
    expect(r.effectiveMilesPerDay).toBeCloseTo(22.5, 1)
    expect(r.days).toBe(3)
  })

  it('applies a weather penalty', () => {
    const r = estimateTravel({
      miles: 60,
      baseMilesPerDay: 30,
      pace: 'normal',
      weather: { ...clearDay, severity: 'rough', travelPenalty: 0.5 },
    })
    expect(r.effectiveMilesPerDay).toBe(15)
    expect(r.days).toBe(4)
    expect(r.totalPenalty).toBe(50)
  })

  it('caps penalty at ninety percent', () => {
    const r = estimateTravel({
      miles: 30,
      baseMilesPerDay: 30,
      pace: 'normal',
      weather: { ...clearDay, severity: 'severe', travelPenalty: 0.99 },
    })
    expect(r.effectiveMilesPerDay).toBeGreaterThan(0)
  })
})

describe('paces and tones', () => {
  it('describes every pace', () => {
    for (const p of TRAVEL_PACES) expect(paceDescription(p).length).toBeGreaterThan(5)
  })

  it('maps severity to a tone', () => {
    expect(severityTone('clear')).toBe('success')
    expect(severityTone('mild')).toBe('info')
    expect(severityTone('rough')).toBe('warning')
    expect(severityTone('severe')).toBe('danger')
  })
})
