import { describe, expect, it } from 'vitest'

import {
  TEMPLATE_ROLES,
  compareForListing,
  encounterTemplateDraftSchema,
  monsterCountFor,
  presetTemplates,
  roleLabel,
  roleTone,
  totalXpFor,
} from './encounter-template'

describe('roles', () => {
  it('exposes the five roles with labels and tones', () => {
    expect(TEMPLATE_ROLES).toEqual(['mook', 'lieutenant', 'boss', 'ally', 'environmental'])
    for (const r of TEMPLATE_ROLES) {
      expect(roleLabel(r).length).toBeGreaterThan(0)
      expect(typeof roleTone(r)).toBe('string')
    }
  })
})

describe('presetTemplates', () => {
  it('ships a handful of templates spanning levels', () => {
    const presets = presetTemplates()
    expect(presets.length).toBeGreaterThanOrEqual(3)
    const levels = presets.map((p) => p.recommendedLevel)
    expect(Math.min(...levels)).toBeLessThan(Math.max(...levels))
  })

  it('every preset has a non empty name and monsters', () => {
    for (const p of presetTemplates()) {
      expect(p.name.length).toBeGreaterThan(0)
      expect(p.monsters.length).toBeGreaterThan(0)
    }
  })
})

describe('totalXpFor and monsterCountFor', () => {
  it('multiplies xp by count', () => {
    const preset = presetTemplates().find((p) => p.id === 'preset_goblin_ambush')!
    expect(totalXpFor(preset)).toBe(50 * 5)
    expect(monsterCountFor(preset)).toBe(5)
  })
})

describe('compareForListing', () => {
  it('sorts by recommended level then alphabetically', () => {
    const presets = [...presetTemplates()].sort(compareForListing)
    for (let i = 1; i < presets.length; i++) {
      expect(presets[i - 1]!.recommendedLevel).toBeLessThanOrEqual(presets[i]!.recommendedLevel)
    }
  })
})

describe('encounterTemplateDraftSchema', () => {
  it('accepts a minimal draft', () => {
    expect(encounterTemplateDraftSchema.safeParse({ name: 'A' }).success).toBe(true)
  })

  it('rejects an empty name', () => {
    expect(encounterTemplateDraftSchema.safeParse({ name: '   ' }).success).toBe(false)
  })

  it('rejects too many monsters', () => {
    const monsters = Array.from({ length: 40 }, () => ({
      name: 'goblin',
      count: 1,
      xp: 50,
      role: 'mook' as const,
    }))
    expect(encounterTemplateDraftSchema.safeParse({ name: 'X', monsters }).success).toBe(false)
  })

  it('rejects out of range levels', () => {
    expect(encounterTemplateDraftSchema.safeParse({ name: 'X', recommendedLevel: 99 }).success).toBe(false)
  })
})
