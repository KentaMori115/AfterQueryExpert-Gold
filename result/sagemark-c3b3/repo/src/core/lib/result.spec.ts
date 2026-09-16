import { describe, expect, it } from 'vitest'

import { collect, err, isErr, isOk, mapResult, ok, unwrap, unwrapOr } from './result'

describe('ok / err', () => {
  it('builds ok values', () => {
    const r = ok(42)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value).toBe(42)
  })

  it('builds err values', () => {
    const r = err('boom')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('boom')
  })
})

describe('isOk / isErr', () => {
  it('narrows the type when checked', () => {
    const r = ok('yes') as ReturnType<typeof ok<string>> | ReturnType<typeof err<string>>
    if (isOk(r)) {
      expect(r.value.length).toBeGreaterThan(0)
    }
    const e = err('nope') as typeof r
    expect(isErr(e)).toBe(true)
  })
})

describe('mapResult', () => {
  it('maps over ok', () => {
    const r = mapResult(ok(2), (n) => n * 5)
    expect(r).toEqual(ok(10))
  })

  it('passes err through unchanged', () => {
    const r = mapResult(err('bad'), (n: number) => n * 5)
    expect(r).toEqual(err('bad'))
  })
})

describe('unwrap / unwrapOr', () => {
  it('returns the value on ok', () => {
    expect(unwrap(ok('x'))).toBe('x')
    expect(unwrapOr(ok('x'), 'fallback')).toBe('x')
  })

  it('throws on err for unwrap', () => {
    expect(() => unwrap(err('boom'))).toThrow(/boom/)
  })

  it('returns fallback on err for unwrapOr', () => {
    expect(unwrapOr(err('boom'), 'fallback')).toBe('fallback')
  })
})

describe('collect', () => {
  it('returns ok of an array when all entries are ok', () => {
    const r = collect([ok(1), ok(2), ok(3)])
    expect(r).toEqual(ok([1, 2, 3]))
  })

  it('short-circuits on the first err', () => {
    const r = collect([ok(1), err('mid'), ok(3)])
    expect(r).toEqual(err('mid'))
  })

  it('handles empty input', () => {
    expect(collect([])).toEqual(ok([]))
  })
})
