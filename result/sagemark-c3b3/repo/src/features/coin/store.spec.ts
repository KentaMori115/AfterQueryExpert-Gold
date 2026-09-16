import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { asCharacterId } from '@core/ids/brand'

import { useCoinStore } from './store'

const charA = asCharacterId('char_A')

describe('useCoinStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    window.localStorage.clear()
  })

  it('returns an empty purse for a new character', () => {
    const store = useCoinStore()
    expect(store.purseFor(charA)).toEqual({ cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 })
  })

  it('bump records a ledger entry and updates the purse', () => {
    const store = useCoinStore()
    store.bump(charA, 'gp', 7, 'tavern fight reward')
    expect(store.purseFor(charA).gp).toBe(7)
    const log = store.ledgerFor(charA)
    expect(log).toHaveLength(1)
    expect(log[0]!.reason).toBe('tavern fight reward')
  })

  it('bump clamps at zero for negative deltas', () => {
    const store = useCoinStore()
    store.bump(charA, 'gp', 5, 'init')
    store.bump(charA, 'gp', -10, 'bribed the guard')
    expect(store.purseFor(charA).gp).toBe(0)
  })

  it('depositPurse adds across coin kinds and logs each non zero', () => {
    const store = useCoinStore()
    store.depositPurse(charA, { cp: 5, sp: 0, ep: 0, gp: 2, pp: 0 }, 'sold the broken sword')
    expect(store.purseFor(charA).cp).toBe(5)
    expect(store.purseFor(charA).gp).toBe(2)
    expect(store.ledgerFor(charA)).toHaveLength(2)
  })

  it('consolidate promotes copper into silver and beyond', () => {
    const store = useCoinStore()
    store.setPurse(charA, { cp: 250, sp: 0, ep: 0, gp: 0, pp: 0 })
    store.consolidate(charA)
    const purse = store.purseFor(charA)
    expect(purse.cp).toBe(0)
    expect(purse.sp).toBe(5)
    expect(purse.gp).toBe(2)
  })

  it('clearLedger wipes just this character', () => {
    const store = useCoinStore()
    store.bump(charA, 'gp', 5, 'init')
    store.clearLedger(charA)
    expect(store.ledgerFor(charA)).toEqual([])
  })

  it('persists across re-init', () => {
    const first = useCoinStore()
    first.bump(charA, 'gp', 9, 'persisted')
    setActivePinia(createPinia())
    const second = useCoinStore()
    expect(second.purseFor(charA).gp).toBe(9)
  })
})
