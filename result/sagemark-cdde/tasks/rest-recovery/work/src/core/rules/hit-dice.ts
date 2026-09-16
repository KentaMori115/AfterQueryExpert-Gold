// Hit dice as a spendable pool. A stat block writes its dice as a roll
// expression ('5d8', '3d10+2d6'), so the pool is parsed with the same reader
// the dice tray uses and kept grouped by die size, largest size first.

import { parseRollExpression } from '../dice/notation'
import { rollExpression, type RandomSource } from '../dice/roll'

export interface HitDiceGroup {
  sides: number
  total: number
  spent: number
}

export type HitDicePool = ReadonlyArray<HitDiceGroup>

export class HitDiceError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'HitDiceError'
  }
}

export function emptyHitDicePool(): HitDicePool {
  return []
}

export function parseHitDicePool(text: string): HitDicePool {
  const expression = parseRollExpression(text)
  const bySides = new Map<number, number>()
  for (let i = 0; i < expression.terms.length; i++) {
    const term = expression.terms[i]!
    const sign = expression.signs[i] ?? 1
    if (term.kind !== 'dice') {
      throw new HitDiceError(`hit dice cannot carry a flat term in "${text}"`)
    }
    if (term.modifier !== 'none') {
      throw new HitDiceError(`hit dice cannot carry a die modifier in "${text}"`)
    }
    if (sign === -1) {
      throw new HitDiceError(`hit dice cannot be subtracted in "${text}"`)
    }
    bySides.set(term.sides, (bySides.get(term.sides) ?? 0) + term.count)
  }
  const groups: HitDiceGroup[] = []
  for (const [sides, total] of bySides.entries()) {
    groups.push({ sides, total, spent: 0 })
  }
  return sortPool(groups)
}

export function totalDice(pool: HitDicePool): number {
  return pool.reduce((acc, g) => acc + g.total, 0)
}

export function spentDice(pool: HitDicePool): number {
  return pool.reduce((acc, g) => acc + g.spent, 0)
}

export function availableDice(pool: HitDicePool): number {
  return pool.reduce((acc, g) => acc + Math.max(0, g.total - g.spent), 0)
}

export function largestAvailable(pool: HitDicePool): number | null {
  for (const g of sortPool(pool)) {
    if (g.total - g.spent > 0) return g.sides
  }
  return null
}

export function spendDie(pool: HitDicePool, sides: number): HitDicePool {
  const group = pool.find((g) => g.sides === sides)
  if (!group) {
    throw new HitDiceError(`no d${sides} in this pool`)
  }
  if (group.total - group.spent <= 0) {
    throw new HitDiceError(`every d${sides} is already spent`)
  }
  return sortPool(
    pool.map((g) => (g.sides === sides ? { ...g, spent: g.spent + 1 } : { ...g })),
  )
}

export function regainDice(pool: HitDicePool, count: number): HitDicePool {
  let left = Math.max(0, Math.floor(count))
  const next = sortPool(pool).map((g) => ({ ...g }))
  for (const group of next) {
    if (left <= 0) break
    const back = Math.min(group.spent, left)
    group.spent -= back
    left -= back
  }
  return next
}

export function resetPool(pool: HitDicePool): HitDicePool {
  return sortPool(pool).map((g) => ({ ...g, spent: 0 }))
}

export interface HitDieRoll {
  sides: number
  rolled: number
  healed: number
}

export function rollHitDie(sides: number, conModifier: number, rng: RandomSource): HitDieRoll {
  const rolled = rollExpression(`1d${sides}`, rng).total
  return { sides, rolled, healed: Math.max(1, rolled + Math.floor(conModifier)) }
}

export function formatPool(pool: HitDicePool): string {
  const parts = sortPool(pool)
    .filter((g) => g.total > 0)
    .map((g) => `${Math.max(0, g.total - g.spent)}/${g.total}d${g.sides}`)
  return parts.length === 0 ? 'no hit dice' : parts.join(', ')
}

function sortPool(pool: HitDicePool): HitDiceGroup[] {
  return [...pool].sort((a, b) => b.sides - a.sides).map((g) => ({ ...g }))
}
