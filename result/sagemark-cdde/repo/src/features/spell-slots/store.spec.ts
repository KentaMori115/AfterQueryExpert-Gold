import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { asCharacterId } from '@core/ids/brand'

import { useSpellSlotStore } from './store'

const charA = asCharacterId('char_A')

describe('useSpellSlotStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    window.localStorage.clear()
  })

  it('returns an empty state for an unseen character', () => {
    const store = useSpellSlotStore()
    const s = store.get(charA)
    expect(s[1].max).toBe(0)
  })

  it('bootstrap fills slots for the given caster level', () => {
    const store = useSpellSlotStore()
    const s = store.bootstrap(charA, 5)
    expect(s[3].max).toBe(2)
    expect(s[3].remaining).toBe(2)
  })

  it('spend reduces remaining', () => {
    const store = useSpellSlotStore()
    store.bootstrap(charA, 5)
    store.spend(charA, 3)
    expect(store.get(charA)[3].remaining).toBe(1)
  })

  it('restore caps at the max', () => {
    const store = useSpellSlotStore()
    store.bootstrap(charA, 5)
    store.spend(charA, 1)
    store.restore(charA, 1, 99)
    expect(store.get(charA)[1].remaining).toBe(store.get(charA)[1].max)
  })

  it('longRest refills every level', () => {
    const store = useSpellSlotStore()
    store.bootstrap(charA, 5)
    store.spend(charA, 1)
    store.spend(charA, 2)
    store.longRest(charA)
    expect(store.get(charA)[1].remaining).toBe(store.get(charA)[1].max)
    expect(store.get(charA)[2].remaining).toBe(store.get(charA)[2].max)
  })

  it('clear wipes the saved state', () => {
    const store = useSpellSlotStore()
    store.bootstrap(charA, 3)
    store.clear(charA)
    expect(store.get(charA)[1].max).toBe(0)
  })

  it('persists across re-init', () => {
    const first = useSpellSlotStore()
    first.bootstrap(charA, 4)
    first.spend(charA, 1)
    setActivePinia(createPinia())
    const second = useSpellSlotStore()
    expect(second.get(charA)[1].max).toBe(4)
    expect(second.get(charA)[1].remaining).toBe(3)
  })
})
