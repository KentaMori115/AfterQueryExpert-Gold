import { describe, expect, it } from 'vitest'

import {
  LIGHT_SOURCES,
  VISIONS,
  burnDownMinutes,
  effectivelySeesAt,
  lightProfile,
  visibilityAt,
  visionLabel,
} from './light'

describe('catalog', () => {
  it('lists known light sources with labels and radii', () => {
    expect(LIGHT_SOURCES.length).toBeGreaterThanOrEqual(5)
    for (const s of LIGHT_SOURCES) {
      const p = lightProfile(s)
      expect(p.label.length).toBeGreaterThan(0)
      expect(p.brightFeet).toBeGreaterThan(0)
      expect(p.dimFeet).toBeGreaterThan(0)
    }
  })

  it('labels every vision tier', () => {
    expect(VISIONS).toContain('darkvision-60')
    for (const v of VISIONS) expect(visionLabel(v).length).toBeGreaterThan(0)
  })
})

describe('visibilityAt', () => {
  it('marks the bright then dim then darkness rings', () => {
    expect(visibilityAt(10, 'torch')).toBe('bright')
    expect(visibilityAt(30, 'torch')).toBe('dim')
    expect(visibilityAt(60, 'torch')).toBe('darkness')
  })

  it('respects ambient when no source is provided', () => {
    expect(visibilityAt(60, null, 'bright')).toBe('bright')
  })
})

describe('effectivelySeesAt', () => {
  it('normal vision sees only in bright light', () => {
    expect(effectivelySeesAt(10, 'normal', 'torch')).toBe(true)
    expect(effectivelySeesAt(30, 'normal', 'torch')).toBe(false)
    expect(effectivelySeesAt(80, 'normal', null)).toBe(false)
  })

  it('darkvision 60 reaches into darkness up to 60 ft', () => {
    expect(effectivelySeesAt(50, 'darkvision-60', null)).toBe(true)
    expect(effectivelySeesAt(70, 'darkvision-60', null)).toBe(false)
  })

  it('darkvision 120 reaches further', () => {
    expect(effectivelySeesAt(100, 'darkvision-120', null)).toBe(true)
    expect(effectivelySeesAt(140, 'darkvision-120', null)).toBe(false)
  })

  it('blindsight and truesight ignore distance bands in this simplification', () => {
    expect(effectivelySeesAt(1000, 'blindsight', null)).toBe(true)
    expect(effectivelySeesAt(1000, 'truesight', null)).toBe(true)
  })
})

describe('burnDownMinutes', () => {
  it('clamps at zero and floors the result', () => {
    expect(burnDownMinutes(60, 30)).toBe(30)
    expect(burnDownMinutes(60, 90)).toBe(0)
    expect(burnDownMinutes(60, -5)).toBe(60)
  })

  it('treats infinity as a constant', () => {
    expect(burnDownMinutes(Number.POSITIVE_INFINITY, 99)).toBe(Number.POSITIVE_INFINITY)
  })
})
