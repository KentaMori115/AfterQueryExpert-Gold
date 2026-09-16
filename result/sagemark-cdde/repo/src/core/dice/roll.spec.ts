import { describe, expect, it } from 'vitest'

import {
  buildSeededRng,
  rollExpression,
  summariseResult,
} from './roll'

describe('rollExpression with a deterministic rng', () => {
  it('rolls a single die using the provided rng', () => {
    const rng = buildSeededRng(1)
    const result = rollExpression('d20', rng)
    expect(result.total).toBeGreaterThanOrEqual(1)
    expect(result.total).toBeLessThanOrEqual(20)
    expect(result.terms[0]?.dice).toHaveLength(1)
  })

  it('repeats for the same seed', () => {
    const a = rollExpression('4d6kh3 + 2', buildSeededRng(99))
    const b = rollExpression('4d6kh3 + 2', buildSeededRng(99))
    expect(a.total).toBe(b.total)
    expect(a.terms[0]?.dice?.map((d) => d.value)).toEqual(b.terms[0]?.dice?.map((d) => d.value))
  })

  it('keep-highest discards the lower dice from the kept set', () => {
    const result = rollExpression('4d6kh3', buildSeededRng(7))
    const dice = result.terms[0]?.dice as Array<{ value: number; kept: boolean }>
    const kept = dice.filter((d) => d.kept)
    expect(kept).toHaveLength(3)
    const min = Math.min(...kept.map((d) => d.value))
    const dropped = dice.find((d) => !d.kept)!
    expect(dropped.value).toBeLessThanOrEqual(min)
  })

  it('advantage keeps the higher of two', () => {
    const result = rollExpression('d20adv', buildSeededRng(13))
    const dice = result.terms[0]?.dice as Array<{ value: number; kept: boolean }>
    expect(dice).toHaveLength(2)
    const keptValue = dice.find((d) => d.kept)!.value
    expect(keptValue).toBe(Math.max(...dice.map((d) => d.value)))
  })

  it('disadvantage keeps the lower of two', () => {
    const result = rollExpression('d20dis', buildSeededRng(13))
    const dice = result.terms[0]?.dice as Array<{ value: number; kept: boolean }>
    const keptValue = dice.find((d) => d.kept)!.value
    expect(keptValue).toBe(Math.min(...dice.map((d) => d.value)))
  })

  it('sums signs across multiple terms', () => {
    const result = rollExpression('d4 + 5 - d4', () => 0)
    expect(result.total).toBe(1 + 5 - 1)
  })

  it('summariseResult renders compactly', () => {
    const result = rollExpression('d20 + 4', () => 0)
    expect(summariseResult(result)).toContain('= ')
  })

  it('rolls land within bounds for many iterations', () => {
    const rng = buildSeededRng(42)
    for (let i = 0; i < 200; i++) {
      const r = rollExpression('3d8', rng)
      expect(r.total).toBeGreaterThanOrEqual(3)
      expect(r.total).toBeLessThanOrEqual(24)
    }
  })

  it('reflects the kept flag on raw rolls', () => {
    const result = rollExpression('5d6kl2', buildSeededRng(3))
    const kept = (result.terms[0]?.dice ?? []).filter((d) => d.kept)
    expect(kept).toHaveLength(2)
  })
})
