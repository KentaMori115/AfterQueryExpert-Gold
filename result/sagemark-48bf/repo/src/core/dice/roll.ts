import { parseRollExpression, type DiceTerm, type RollExpression, type RollTerm } from './notation'

export interface RolledDie {
  sides: number
  value: number
  kept: boolean
}

export interface RolledTerm {
  kind: 'dice' | 'constant'
  sign: 1 | -1
  display: string
  faces?: number
  dice?: ReadonlyArray<RolledDie>
  value: number
}

export interface RollResult {
  expression: string
  total: number
  terms: ReadonlyArray<RolledTerm>
  rolledAt: number
  notation: RollExpression
}

export type RandomSource = () => number

const defaultRandom: RandomSource = () => Math.random()

export function rollExpression(input: string, rng: RandomSource = defaultRandom): RollResult {
  const notation = parseRollExpression(input)
  return rollParsed(input, notation, rng)
}

export function rollParsed(
  original: string,
  notation: RollExpression,
  rng: RandomSource = defaultRandom,
): RollResult {
  const rolled: RolledTerm[] = []
  let total = 0
  for (let i = 0; i < notation.terms.length; i++) {
    const sign = notation.signs[i] ?? 1
    const term = notation.terms[i]!
    const r = rollTerm(term, rng, sign)
    rolled.push(r)
    total += sign * r.value
  }
  return {
    expression: original,
    total,
    terms: rolled,
    rolledAt: Date.now(),
    notation,
  }
}

function rollDie(sides: number, rng: RandomSource): number {
  return Math.max(1, Math.min(sides, Math.floor(rng() * sides) + 1))
}

function rollTerm(term: RollTerm, rng: RandomSource, sign: 1 | -1): RolledTerm {
  if (term.kind === 'constant') {
    return {
      kind: 'constant',
      sign,
      display: String(term.value),
      value: term.value,
    }
  }
  return rollDiceTerm(term, rng, sign)
}

function rollDiceTerm(term: DiceTerm, rng: RandomSource, sign: 1 | -1): RolledTerm {
  const sides = term.sides
  let count = term.count
  if (term.modifier === 'advantage' || term.modifier === 'disadvantage') {
    count = 2
  }
  const rolls: RolledDie[] = []
  for (let i = 0; i < count; i++) {
    rolls.push({ sides, value: rollDie(sides, rng), kept: true })
  }
  if (term.modifier === 'advantage') {
    keepBest(rolls, 1)
  } else if (term.modifier === 'disadvantage') {
    keepWorst(rolls, 1)
  } else if (term.modifier === 'keep-highest' && term.modifierAmount) {
    keepBest(rolls, term.modifierAmount)
  } else if (term.modifier === 'keep-lowest' && term.modifierAmount) {
    keepWorst(rolls, term.modifierAmount)
  }
  const value = rolls.filter((r) => r.kept).reduce((s, r) => s + r.value, 0)
  return {
    kind: 'dice',
    sign,
    display: formatDiceDisplay(term),
    faces: sides,
    dice: rolls,
    value,
  }
}

function keepBest(rolls: RolledDie[], k: number): void {
  const sorted = [...rolls].sort((a, b) => b.value - a.value)
  const keep = new Set(sorted.slice(0, k))
  for (const r of rolls) r.kept = keep.has(r)
}

function keepWorst(rolls: RolledDie[], k: number): void {
  const sorted = [...rolls].sort((a, b) => a.value - b.value)
  const keep = new Set(sorted.slice(0, k))
  for (const r of rolls) r.kept = keep.has(r)
}

function formatDiceDisplay(term: DiceTerm): string {
  let base = `${term.count}d${term.sides}`
  if (term.modifier === 'keep-highest') base += `kh${term.modifierAmount}`
  else if (term.modifier === 'keep-lowest') base += `kl${term.modifierAmount}`
  else if (term.modifier === 'advantage') base = `d${term.sides}adv`
  else if (term.modifier === 'disadvantage') base = `d${term.sides}dis`
  return base
}

export function summariseResult(result: RollResult): string {
  const parts: string[] = []
  for (let i = 0; i < result.terms.length; i++) {
    const t = result.terms[i]!
    if (i === 0) {
      parts.push(t.sign === -1 ? `-${t.display}` : t.display)
    } else {
      parts.push(t.sign === -1 ? `- ${t.display}` : `+ ${t.display}`)
    }
  }
  return `${parts.join(' ')} = ${result.total}`
}

export function buildSeededRng(seed: number): RandomSource {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 0x1_00000000
  }
}
