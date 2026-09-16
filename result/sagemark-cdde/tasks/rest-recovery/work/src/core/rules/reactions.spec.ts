import { describe, expect, it } from 'vitest'

import { buildSeededRng } from '../dice/roll'

import {
  MORALE_TIERS,
  REACTION_MOODS,
  classifyReaction,
  moodDescription,
  moodLabel,
  moodTone,
  moraleRating,
  rollMorale,
  rollReaction,
  tierLabel,
} from './reactions'

describe('moods', () => {
  it('lists every mood with label, tone and description', () => {
    expect(REACTION_MOODS).toEqual([
      'hostile',
      'unfriendly',
      'cautious',
      'neutral',
      'friendly',
      'helpful',
    ])
    for (const m of REACTION_MOODS) {
      expect(moodLabel(m).length).toBeGreaterThan(0)
      expect(typeof moodTone(m)).toBe('string')
      expect(moodDescription(m).length).toBeGreaterThan(0)
    }
  })
})

describe('classifyReaction', () => {
  it('matches the classic 2d6 bands', () => {
    expect(classifyReaction(2)).toBe('hostile')
    expect(classifyReaction(5)).toBe('unfriendly')
    expect(classifyReaction(7)).toBe('cautious')
    expect(classifyReaction(9)).toBe('neutral')
    expect(classifyReaction(11)).toBe('friendly')
    expect(classifyReaction(12)).toBe('helpful')
  })
})

describe('rollReaction', () => {
  it('rolls two dice in the 1..6 range and adds the modifier', () => {
    const r = rollReaction(buildSeededRng(1), 2)
    expect(r.d1).toBeGreaterThanOrEqual(1)
    expect(r.d1).toBeLessThanOrEqual(6)
    expect(r.d2).toBeGreaterThanOrEqual(1)
    expect(r.d2).toBeLessThanOrEqual(6)
    expect(r.total).toBe(r.d1 + r.d2 + 2)
    expect(REACTION_MOODS).toContain(r.mood)
  })

  it('is deterministic for a given seed', () => {
    const a = rollReaction(buildSeededRng(42), 0)
    const b = rollReaction(buildSeededRng(42), 0)
    expect(a).toEqual(b)
  })
})

describe('moraleRating', () => {
  it('exposes the four tiers', () => {
    expect(MORALE_TIERS).toEqual(['fanatic', 'steady', 'wavering', 'fragile'])
    for (const t of MORALE_TIERS) {
      expect(moraleRating(t)).toBeGreaterThan(0)
      expect(tierLabel(t)).toMatch(/^[A-Z]/)
    }
  })
})

describe('rollMorale', () => {
  it('passes when the roll is below or equal to the rating', () => {
    // seed engineered to land low: we just check the structure of the result
    const r = rollMorale(buildSeededRng(7), 'steady')
    expect(typeof r.passed).toBe('boolean')
    expect(r.total).toBeGreaterThanOrEqual(2)
    expect(r.total).toBeLessThanOrEqual(12)
    expect(r.rating).toBe(9)
    if (r.total <= r.rating) expect(r.passed).toBe(true)
    else expect(r.passed).toBe(false)
  })

  it('margin reflects how much was passed by or failed by', () => {
    const r = rollMorale(buildSeededRng(13), 'steady')
    expect(r.margin).toBe(r.rating - r.total)
  })
})
