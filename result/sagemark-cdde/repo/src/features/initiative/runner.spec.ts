import { describe, expect, it } from 'vitest'

import type { InitiativeEntry } from '@core/models/encounter'

import {
  activeEntry,
  advance,
  applyDamage,
  applyHealing,
  emptyRunnerState,
  endRun,
  isRunning,
  rewind,
  setCondition,
  startRun,
  totalDamageThisRun,
  totalHealingThisRun,
} from './runner'

function entry(name: string, initiative: number, hp = 10): InitiativeEntry {
  return { characterId: null, name, initiative, hp, notes: '' }
}

const at = (s: string): Date => new Date(s)

describe('runner state transitions', () => {
  it('starts as not running', () => {
    const s = emptyRunnerState('enc_X')
    expect(isRunning(s)).toBe(false)
  })

  it('startRun moves into round 1 and logs the event', () => {
    const s = startRun(emptyRunnerState('enc_X'), at('2026-01-01T20:00:00Z'))
    expect(s.round).toBe(1)
    expect(s.startedAt).toBe('2026-01-01T20:00:00.000Z')
    expect(s.log.some((l) => l.kind === 'start')).toBe(true)
  })

  it('endRun returns the state to idle and adds an end log', () => {
    const s = endRun(startRun(emptyRunnerState('enc_X')))
    expect(isRunning(s)).toBe(false)
    expect(s.log.some((l) => l.kind === 'end')).toBe(true)
  })
})

describe('advance and rewind', () => {
  const order = [entry('Alva', 20), entry('Brann', 15), entry('Cael', 5)]

  it('starts when called from idle', () => {
    const s = advance(emptyRunnerState('enc_X'), order)
    expect(s.round).toBe(1)
  })

  it('advances the turnIndex through the order', () => {
    let s = startRun(emptyRunnerState('enc_X'))
    s = advance(s, order)
    expect(s.turnIndex).toBe(1)
    s = advance(s, order)
    expect(s.turnIndex).toBe(2)
  })

  it('wraps to round 2 after the last turn and logs the round change', () => {
    let s = startRun(emptyRunnerState('enc_X'))
    s = advance(s, order)
    s = advance(s, order)
    s = advance(s, order)
    expect(s.round).toBe(2)
    expect(s.turnIndex).toBe(0)
    expect(s.log.some((l) => l.kind === 'round' && l.round === 2)).toBe(true)
  })

  it('rewind steps back, wrapping rounds where needed', () => {
    let s = startRun(emptyRunnerState('enc_X'))
    s = advance(s, order)
    s = advance(s, order)
    s = rewind(s, order)
    expect(s.turnIndex).toBe(1)
    s = rewind(s, order)
    s = rewind(s, order)
    expect(s.round).toBe(1)
  })

  it('rewind on the very first turn is a no op', () => {
    const s = startRun(emptyRunnerState('enc_X'))
    expect(rewind(s, order)).toEqual(s)
  })
})

describe('activeEntry', () => {
  const order = [entry('A', 20), entry('B', 10)]

  it('returns null when not running', () => {
    expect(activeEntry(emptyRunnerState('enc_X'), order)).toBe(null)
  })

  it('returns the right entry by turnIndex when running', () => {
    let s = startRun(emptyRunnerState('enc_X'))
    expect(activeEntry(s, order)?.name).toBe('A')
    s = advance(s, order)
    expect(activeEntry(s, order)?.name).toBe('B')
  })

  it('clamps when the order changes mid run', () => {
    let s = startRun(emptyRunnerState('enc_X'))
    s = advance(s, order)
    expect(activeEntry(s, [entry('A', 20)])?.name).toBe('A')
  })
})

describe('damage and healing logs', () => {
  it('applyDamage updates the entry and adds a damage log', () => {
    const entries = [entry('A', 20, 10)]
    const s = startRun(emptyRunnerState('enc_X'))
    const { entries: next, state } = applyDamage(s, entries, 0, 4)
    expect(next[0]?.hp).toBe(6)
    expect(state.log.some((l) => l.kind === 'damage')).toBe(true)
  })

  it('applyDamage with non positive amount is a no op', () => {
    const entries = [entry('A', 20, 10)]
    const s = startRun(emptyRunnerState('enc_X'))
    const { entries: next } = applyDamage(s, entries, 0, 0)
    expect(next[0]?.hp).toBe(10)
  })

  it('applyHealing increases hp and adds a heal log', () => {
    const entries = [entry('A', 20, 5)]
    const s = startRun(emptyRunnerState('enc_X'))
    const { entries: next } = applyHealing(s, entries, 0, 4)
    expect(next[0]?.hp).toBe(9)
  })

  it('totals across the run', () => {
    let s = startRun(emptyRunnerState('enc_X'))
    let entries = [entry('A', 20, 12), entry('B', 10, 8)]
    ;({ entries, state: s } = applyDamage(s, entries, 0, 4))
    ;({ entries, state: s } = applyDamage(s, entries, 1, 3))
    ;({ entries, state: s } = applyHealing(s, entries, 0, 2))
    expect(totalDamageThisRun(s)).toBe(7)
    expect(totalHealingThisRun(s)).toBe(2)
  })
})

describe('conditions', () => {
  it('sets and dedupes conditions', () => {
    const s = setCondition(startRun(emptyRunnerState('enc_X')), 'Alva', ['stunned', 'STUNNED', 'prone'])
    expect(s.conditions.Alva).toEqual(['stunned', 'STUNNED', 'prone'].filter((_, i, a) => a.indexOf(_) === i))
  })

  it('logs cleared conditions when the list is empty', () => {
    const s = setCondition(emptyRunnerState('enc_X'), 'Alva', [])
    expect(s.log.at(-1)?.message).toContain('cleared')
  })
})
