import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { asCharacterId } from '@core/ids/brand'

import { useStatBlockStore } from './store'

const charA = asCharacterId('char_A')

describe('useStatBlockStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    window.localStorage.clear()
  })

  it('returns an empty default for unseen characters', () => {
    const store = useStatBlockStore()
    const block = store.get(charA)
    expect(block.hp).toBe(10)
    expect(store.tryGet(charA)).toBeNull()
  })

  it('setAbility clamps to 1..30', () => {
    const store = useStatBlockStore()
    store.setAbility(charA, 'str', 99)
    expect(store.get(charA).abilities.str).toBe(30)
    store.setAbility(charA, 'dex', -5)
    expect(store.get(charA).abilities.dex).toBe(1)
  })

  it('damage and heal walk the hp value', () => {
    const store = useStatBlockStore()
    store.configureMax(charA, 20)
    store.heal(charA, 99) // top off after raising max
    expect(store.get(charA).hp).toBe(20)
    store.damage(charA, 7)
    expect(store.get(charA).hp).toBe(13)
    store.heal(charA, 4)
    expect(store.get(charA).hp).toBe(17)
    store.heal(charA, 99)
    expect(store.get(charA).hp).toBe(20)
  })

  it('configureMax clamps current hp when lowered', () => {
    const store = useStatBlockStore()
    store.configureMax(charA, 20)
    store.damage(charA, 0)
    store.configureMax(charA, 12)
    expect(store.get(charA).hp).toBeLessThanOrEqual(12)
  })

  it('fullRest restores hp to max', () => {
    const store = useStatBlockStore()
    store.configureMax(charA, 30)
    store.damage(charA, 20)
    store.fullRest(charA)
    expect(store.get(charA).hp).toBe(30)
  })

  it('remove drops the saved block', () => {
    const store = useStatBlockStore()
    store.setAbility(charA, 'str', 16)
    store.remove(charA)
    expect(store.tryGet(charA)).toBeNull()
  })

  it('persists across re-init', () => {
    const first = useStatBlockStore()
    first.setAbility(charA, 'str', 18)
    setActivePinia(createPinia())
    const second = useStatBlockStore()
    expect(second.get(charA).abilities.str).toBe(18)
  })
})
