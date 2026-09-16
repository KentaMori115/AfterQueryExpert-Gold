import { describe, expect, it } from 'vitest'
import { alignUtc, average, rollup } from './buckets'

describe('timeseries rollup', () => {
  it('aligns timestamps to UTC hour boundaries', () => {
    expect(alignUtc(Date.UTC(2024, 0, 1, 13, 44, 12), 'hour')).toBe(Date.UTC(2024, 0, 1, 13, 0, 0))
    expect(alignUtc(Date.UTC(2024, 0, 1, 0, 0, 0), 'day')).toBe(Date.UTC(2024, 0, 1))
  })

  it('fills empty buckets and ignores samples outside the range', () => {
    const from = Date.UTC(2024, 0, 1, 0, 0, 0)
    const to = Date.UTC(2024, 0, 1, 3, 0, 0)
    const buckets = rollup(
      [
        { at: from - 1, value: 99 },
        { at: from + 10, value: 4 },
        { at: from + 20, value: 6 },
        { at: from + 3_600_000 + 5, value: 10 },
        { at: to, value: 50 },
      ],
      'hour',
      from,
      to
    )

    expect(buckets).toHaveLength(3)
    expect(buckets[0].sum).toBe(10)
    expect(average(buckets[0])).toBe(5)
    expect(buckets[1].sum).toBe(10)
    expect(buckets[2].count).toBe(0)
    expect(buckets[2].min).toBe(0)
  })
})
