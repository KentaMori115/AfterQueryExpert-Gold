import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { asEncounterId } from '@core/ids'
import type { InitiativeEntry } from '@core/models/encounter'

import { useInitiativeStore } from './store'

const encId = asEncounterId('enc_ABC')

function entry(name: string, init: number, hp = 10): InitiativeEntry {
  return { characterId: null, name, initiative: init, hp, notes: '' }
}

describe('useInitiativeStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    window.localStorage.clear()
  })

  it('lazily creates a runner for an unknown encounter', () => {
    const s = useInitiativeStore()
    expect(s.getState(encId).round).toBe(0)
  })

  it('start moves the runner into round 1', () => {
    const s = useInitiativeStore()
    s.start(encId)
    expect(s.getState(encId).round).toBe(1)
  })

  it('step wraps round, back rewinds', () => {
    const s = useInitiativeStore()
    s.start(encId)
    const order = [entry('A', 20), entry('B', 10)]
    s.step(encId, order)
    s.step(encId, order)
    expect(s.getState(encId).round).toBe(2)
    s.back(encId, order)
    expect(s.getState(encId).round).toBe(1)
  })

  it('damage and heal apply through the store', () => {
    const s = useInitiativeStore()
    s.start(encId)
    const entries = [entry('A', 20, 10)]
    const d = s.damage(encId, entries, 0, 3)
    expect(d.entries[0]?.hp).toBe(7)
    const h = s.heal(encId, d.entries, 0, 2)
    expect(h.entries[0]?.hp).toBe(9)
  })

  it('setConditions writes the condition list', () => {
    const s = useInitiativeStore()
    s.start(encId)
    s.setConditions(encId, 'A', ['prone'])
    expect(s.getState(encId).conditions.A).toEqual(['prone'])
  })

  it('end closes the runner and increments no longer counts active', () => {
    const s = useInitiativeStore()
    s.start(encId)
    expect(s.activeRuns).toBe(1)
    s.end(encId)
    expect(s.activeRuns).toBe(0)
  })

  it('clear forgets a runner entirely', () => {
    const s = useInitiativeStore()
    s.start(encId)
    s.clear(encId)
    expect(s.getState(encId).log).toEqual([])
  })

  it('persists across reinit', () => {
    const a = useInitiativeStore()
    a.start(encId)
    setActivePinia(createPinia())
    const b = useInitiativeStore()
    expect(b.getState(encId).round).toBe(1)
  })
})
