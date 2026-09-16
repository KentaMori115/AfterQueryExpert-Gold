import { describe, expect, it } from 'vitest'
import { paginate, filterByQuery } from './paginate'

describe('paginate', () => {
  const items = ['a', 'b', 'c', 'd', 'e']

  it('returns the current slice and clamps an oversized page', () => {
    expect(paginate(items, 2, 2)).toEqual({
      items: ['c', 'd'],
      page: 2,
      totalPages: 3,
      total: 5,
      start: 3,
      end: 4,
    })
    expect(paginate(items, 99, 2).page).toBe(3)
    expect(paginate([], 3, 2)).toEqual({
      items: [],
      page: 1,
      totalPages: 1,
      total: 0,
      start: 0,
      end: 0,
    })
  })
})

describe('filterByQuery', () => {
  it('matches labels without changing the original array', () => {
    const rows = [{ label: 'Invoice 1' }, { label: 'Credit 2' }]
    expect(filterByQuery(rows, 'credit')).toEqual([{ label: 'Credit 2' }])
    expect(rows).toHaveLength(2)
  })
})
