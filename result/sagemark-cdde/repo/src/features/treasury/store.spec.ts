import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { asCampaignId } from '@core/ids/brand'

import { useTreasuryStore } from './store'

const camp = asCampaignId('camp_X')

describe('useTreasuryStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    window.localStorage.clear()
  })

  it('returns an empty purse for a fresh campaign', () => {
    const store = useTreasuryStore()
    expect(store.purseFor(camp)).toEqual({ cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 })
    expect(store.entriesFor(camp)).toEqual([])
  })

  it('deposit adds coins and records the entry', () => {
    const store = useTreasuryStore()
    store.deposit(camp, { cp: 0, sp: 0, ep: 0, gp: 50, pp: 0 }, 'goblin hoard')
    expect(store.purseFor(camp).gp).toBe(50)
    expect(store.entriesFor(camp)).toHaveLength(1)
    expect(store.entriesFor(camp)[0]!.direction).toBe('deposit')
  })

  it('withdraw subtracts coins and clamps at zero', () => {
    const store = useTreasuryStore()
    store.deposit(camp, { cp: 0, sp: 0, ep: 0, gp: 30, pp: 0 }, 'reserve')
    store.withdraw(camp, { cp: 0, sp: 0, ep: 0, gp: 100, pp: 0 }, 'over reach')
    expect(store.purseFor(camp).gp).toBe(0)
  })

  it('consolidate promotes copper upward', () => {
    const store = useTreasuryStore()
    store.setPurse(camp, { cp: 350, sp: 0, ep: 0, gp: 0, pp: 0 })
    store.consolidate(camp)
    const purse = store.purseFor(camp)
    expect(purse.cp).toBeLessThan(10)
    expect(purse.sp + purse.gp).toBeGreaterThan(0)
  })

  it('party array travels with the entry', () => {
    const store = useTreasuryStore()
    const entry = store.deposit(camp, { cp: 0, sp: 0, ep: 0, gp: 10, pp: 0 }, 'bounty', [
      'Iris',
      'Brann',
    ])
    expect(entry.party).toEqual(['Iris', 'Brann'])
  })

  it('clearLog wipes the log but keeps the purse', () => {
    const store = useTreasuryStore()
    store.deposit(camp, { cp: 0, sp: 0, ep: 0, gp: 10, pp: 0 }, 'r')
    store.clearLog(camp)
    expect(store.entriesFor(camp)).toEqual([])
    expect(store.purseFor(camp).gp).toBe(10)
  })

  it('persists across re-init', () => {
    const first = useTreasuryStore()
    first.deposit(camp, { cp: 0, sp: 0, ep: 0, gp: 7, pp: 0 }, 'persisted')
    setActivePinia(createPinia())
    const second = useTreasuryStore()
    expect(second.purseFor(camp).gp).toBe(7)
    expect(second.entriesFor(camp)).toHaveLength(1)
  })
})
