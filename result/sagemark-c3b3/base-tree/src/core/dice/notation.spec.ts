import { describe, expect, it } from 'vitest'

import { DiceParseError, formatExpression, parseRollExpression } from './notation'

describe('parseRollExpression', () => {
  it('parses a single die with no modifier', () => {
    const r = parseRollExpression('d20')
    expect(r.terms).toHaveLength(1)
    expect(r.terms[0]).toMatchObject({ kind: 'dice', count: 1, sides: 20, modifier: 'none' })
    expect(r.signs).toEqual([1])
  })

  it('parses a multi-die expression', () => {
    const r = parseRollExpression('4d6')
    expect(r.terms[0]).toMatchObject({ count: 4, sides: 6 })
  })

  it('parses keep-highest', () => {
    const r = parseRollExpression('4d6kh3')
    expect(r.terms[0]).toMatchObject({ modifier: 'keep-highest', modifierAmount: 3 })
  })

  it('parses keep-lowest', () => {
    const r = parseRollExpression('4d6kl1')
    expect(r.terms[0]).toMatchObject({ modifier: 'keep-lowest', modifierAmount: 1 })
  })

  it('parses adv and dis when count is 1', () => {
    const r = parseRollExpression('d20adv')
    expect(r.terms[0]).toMatchObject({ modifier: 'advantage' })
    const r2 = parseRollExpression('d20dis')
    expect(r2.terms[0]).toMatchObject({ modifier: 'disadvantage' })
  })

  it('rejects adv on multi-die', () => {
    expect(() => parseRollExpression('2d20adv')).toThrow(DiceParseError)
  })

  it('parses addition and subtraction', () => {
    const r = parseRollExpression('d20 + 4 - d4')
    expect(r.terms).toHaveLength(3)
    expect(r.signs).toEqual([1, 1, -1])
    expect(r.terms[1]).toMatchObject({ kind: 'constant', value: 4 })
  })

  it('parses a leading minus on a constant', () => {
    const r = parseRollExpression('-3 + d20')
    expect(r.signs[0]).toBe(-1)
    expect(r.terms[0]).toMatchObject({ kind: 'constant', value: 3 })
  })

  it('rejects an empty expression', () => {
    expect(() => parseRollExpression('  ')).toThrow(DiceParseError)
  })

  it('rejects gibberish terms', () => {
    expect(() => parseRollExpression('hello + d20')).toThrow(DiceParseError)
  })

  it('rejects out of range die size', () => {
    expect(() => parseRollExpression('d1')).toThrow(DiceParseError)
    expect(() => parseRollExpression('d2000')).toThrow(DiceParseError)
  })

  it('rejects out of range count', () => {
    expect(() => parseRollExpression('200d6')).toThrow(DiceParseError)
  })

  it('rejects keep amounts larger than count', () => {
    expect(() => parseRollExpression('2d6kh5')).toThrow(DiceParseError)
  })
})

describe('formatExpression', () => {
  it('round trips a simple roll', () => {
    const r = parseRollExpression('4d6kh3 + 2')
    expect(formatExpression(r)).toBe('4d6kh3 + 2')
  })

  it('emits a leading minus', () => {
    const r = parseRollExpression('-3 + d20')
    expect(formatExpression(r)).toBe('-3 + 1d20')
  })

  it('writes adv suffix', () => {
    const r = parseRollExpression('d20adv')
    expect(formatExpression(r)).toBe('1d20adv')
  })
})
