import { describe, expect, it } from 'vitest'

import { pageInfoOf, pageWindow, paginate } from './paginate'

const sample = Array.from({ length: 23 }, (_, i) => i)

describe('paginate', () => {
  it('returns the first slice for page 0', () => {
    expect(paginate(sample, { page: 0, perPage: 10 })).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
  })

  it('returns the middle slice', () => {
    expect(paginate(sample, { page: 1, perPage: 10 })).toEqual([10, 11, 12, 13, 14, 15, 16, 17, 18, 19])
  })

  it('returns the tail when the last page is partial', () => {
    expect(paginate(sample, { page: 2, perPage: 10 })).toEqual([20, 21, 22])
  })

  it('clamps a negative page to 0', () => {
    expect(paginate(sample, { page: -3, perPage: 10 }).length).toBe(10)
  })

  it('rounds non-integer per-page down', () => {
    expect(paginate(sample, { page: 0, perPage: 5.7 })).toHaveLength(5)
  })

  it('falls back to perPage 1 when given junk', () => {
    expect(paginate(sample, { page: 0, perPage: 0 })).toHaveLength(1)
  })
})

describe('pageInfoOf', () => {
  it('computes totalPages and clamps the page', () => {
    expect(pageInfoOf(23, { page: 9, perPage: 10 })).toEqual({
      page: 2,
      perPage: 10,
      total: 23,
      totalPages: 3,
    })
  })

  it('reports 0/0 when there are no rows', () => {
    expect(pageInfoOf(0, { page: 5, perPage: 10 })).toEqual({
      page: 0,
      perPage: 10,
      total: 0,
      totalPages: 0,
    })
  })
})

describe('pageWindow', () => {
  it('returns an empty window when there is only one page', () => {
    const info = pageInfoOf(5, { page: 0, perPage: 10 })
    expect(pageWindow(info)).toEqual([])
  })

  it('produces a sliding window centred on the current page', () => {
    const info = pageInfoOf(100, { page: 5, perPage: 5 }) // 20 pages
    expect(pageWindow(info, 5)).toEqual([3, 4, 5, 6, 7])
  })

  it('does not run off the end', () => {
    const info = pageInfoOf(100, { page: 19, perPage: 5 })
    expect(pageWindow(info, 5)).toEqual([15, 16, 17, 18, 19])
  })

  it('does not run off the start', () => {
    const info = pageInfoOf(100, { page: 0, perPage: 5 })
    expect(pageWindow(info, 5)).toEqual([0, 1, 2, 3, 4])
  })
})
