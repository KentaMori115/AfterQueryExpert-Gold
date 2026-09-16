import { describe, expect, it, vi, afterEach } from 'vitest'

import {
  asTimestamp,
  compareTimestamp,
  isAfter,
  now,
  relativeFromNow,
  toDate,
} from './timestamps'

afterEach(() => {
  vi.useRealTimers()
})

describe('now', () => {
  it('returns an iso string', () => {
    const t = now()
    expect(typeof t).toBe('string')
    expect(t.length).toBeGreaterThanOrEqual(19)
    expect(Number.isNaN(Date.parse(t))).toBe(false)
  })

  it('moves forward when system time moves forward', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2025-04-01T12:00:00Z'))
    const a = now()
    vi.setSystemTime(new Date('2025-04-01T12:00:05Z'))
    const b = now()
    expect(b > a).toBe(true)
  })
})

describe('asTimestamp', () => {
  it('accepts a Date', () => {
    const ts = asTimestamp(new Date('2025-05-12T10:00:00Z'))
    expect(Number.isNaN(Date.parse(ts))).toBe(false)
  })

  it('passes valid iso strings through without reparsing', () => {
    const original = '2025-05-12T10:00:00+02:00'
    expect(asTimestamp(original)).toBe(original)
  })

  it('normalises odd strings into iso', () => {
    const ts = asTimestamp('2025-05-12')
    expect(ts.startsWith('2025-05-12')).toBe(true)
  })
})

describe('toDate', () => {
  it('round-trips through asTimestamp', () => {
    const d = new Date('2025-05-12T10:00:00Z')
    const ts = asTimestamp(d)
    expect(toDate(ts).getTime()).toBe(d.getTime())
  })
})

describe('compareTimestamp / isAfter', () => {
  it('compares earlier vs later', () => {
    const a = asTimestamp('2025-05-12T10:00:00Z')
    const b = asTimestamp('2025-05-12T11:00:00Z')
    expect(compareTimestamp(a, b)).toBe(-1)
    expect(compareTimestamp(b, a)).toBe(1)
    expect(compareTimestamp(a, a)).toBe(0)
    expect(isAfter(b, a)).toBe(true)
    expect(isAfter(a, b)).toBe(false)
  })
})

describe('relativeFromNow', () => {
  it('formats a recent past timestamp with a suffix', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2025-05-12T10:30:00Z'))
    const earlier = asTimestamp('2025-05-12T10:00:00Z')
    const phrase = relativeFromNow(earlier)
    expect(phrase).toContain('ago')
  })
})
