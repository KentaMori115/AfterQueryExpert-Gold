import { describe, expect, it } from 'vitest'

import {
  boundingBox,
  distance,
  isFiniteCoord,
  manhattan,
  midpoint,
  paddedBox,
  project,
  viewBox,
} from './map-geometry'

describe('isFiniteCoord', () => {
  it('rejects nan or infinity', () => {
    expect(isFiniteCoord({ x: 0, y: 0 })).toBe(true)
    expect(isFiniteCoord({ x: Number.NaN, y: 0 })).toBe(false)
    expect(isFiniteCoord({ x: 0, y: Number.POSITIVE_INFINITY })).toBe(false)
  })
})

describe('boundingBox', () => {
  it('returns null on empty input', () => {
    expect(boundingBox([])).toBeNull()
  })

  it('finds min and max for a small set', () => {
    const box = boundingBox([
      { x: 1, y: 2 },
      { x: 5, y: -3 },
      { x: -1, y: 7 },
    ])!
    expect(box).toEqual({ minX: -1, minY: -3, maxX: 5, maxY: 7 })
  })

  it('skips non finite coords', () => {
    const box = boundingBox([
      { x: 0, y: 0 },
      { x: Number.NaN, y: 1 },
      { x: 3, y: 4 },
    ])!
    expect(box).toEqual({ minX: 0, minY: 0, maxX: 3, maxY: 4 })
  })
})

describe('paddedBox', () => {
  it('extends every edge', () => {
    expect(paddedBox({ minX: 0, minY: 0, maxX: 10, maxY: 10 }, 2)).toEqual({
      minX: -2,
      minY: -2,
      maxX: 12,
      maxY: 12,
    })
  })
})

describe('project', () => {
  it('maps the box corners to the target corners', () => {
    const box = { minX: 0, minY: 0, maxX: 10, maxY: 10 }
    const target = { width: 100, height: 50 }
    expect(project({ x: 0, y: 0 }, box, target)).toEqual({ x: 0, y: 0 })
    expect(project({ x: 10, y: 10 }, box, target)).toEqual({ x: 100, y: 50 })
    expect(project({ x: 5, y: 5 }, box, target)).toEqual({ x: 50, y: 25 })
  })

  it('handles zero size boxes without dividing by zero', () => {
    const box = { minX: 4, minY: 4, maxX: 4, maxY: 4 }
    const target = { width: 100, height: 100 }
    expect(project({ x: 4, y: 4 }, box, target)).toEqual({ x: 0, y: 0 })
  })
})

describe('distance and manhattan', () => {
  it('measures the right hypotenuse', () => {
    expect(distance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5)
  })

  it('manhattan sums the abs differences', () => {
    expect(manhattan({ x: -1, y: 2 }, { x: 3, y: -2 })).toBe(8)
  })
})

describe('midpoint and viewBox', () => {
  it('midpoint averages the coords', () => {
    expect(midpoint({ x: 2, y: 4 }, { x: 6, y: 8 })).toEqual({ x: 4, y: 6 })
  })

  it('viewBox stringifies', () => {
    expect(viewBox({ minX: 1, minY: 2, maxX: 11, maxY: 22 })).toBe('1 2 10 20')
  })
})
