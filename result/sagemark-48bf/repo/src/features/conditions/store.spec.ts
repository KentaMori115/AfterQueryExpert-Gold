import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { asCharacterId } from '@core/ids/brand'

import { useConditionStore } from './store'

const charA = asCharacterId('char_A')

describe('useConditionStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    window.localStorage.clear()
  })

  it('returns an empty state for unseen characters', () => {
    const store = useConditionStore()
    expect(store.get(charA).active).toEqual([])
    expect(store.get(charA).exhaustion).toBe(0)
  })

  it('adds and removes a condition', () => {
    const store = useConditionStore()
    store.add(charA, 'poisoned')
    store.add(charA, 'prone')
    expect(store.get(charA).active).toEqual(['poisoned', 'prone'])
    store.remove(charA, 'poisoned')
    expect(store.get(charA).active).toEqual(['prone'])
  })

  it('bumpExhaustion clamps within zero to six', () => {
    const store = useConditionStore()
    store.bumpExhaustion(charA, 3)
    expect(store.get(charA).exhaustion).toBe(3)
    store.bumpExhaustion(charA, 99)
    expect(store.get(charA).exhaustion).toBe(6)
    store.bumpExhaustion(charA, -99)
    expect(store.get(charA).exhaustion).toBe(0)
  })

  it('shortRest removes prone and grappled only', () => {
    const store = useConditionStore()
    store.add(charA, 'poisoned')
    store.add(charA, 'prone')
    store.add(charA, 'grappled')
    store.shortRest(charA)
    expect(store.get(charA).active).toEqual(['poisoned'])
  })

  it('longRest clears every condition and steps exhaustion down one', () => {
    const store = useConditionStore()
    store.add(charA, 'poisoned')
    store.bumpExhaustion(charA, 3)
    store.longRest(charA)
    expect(store.get(charA).active).toEqual([])
    expect(store.get(charA).exhaustion).toBe(2)
  })

  it('clear forgets a character entirely', () => {
    const store = useConditionStore()
    store.add(charA, 'poisoned')
    store.clear(charA)
    expect(store.get(charA).active).toEqual([])
  })

  it('persists across re-init', () => {
    const first = useConditionStore()
    first.add(charA, 'poisoned')
    setActivePinia(createPinia())
    const second = useConditionStore()
    expect(second.get(charA).active).toEqual(['poisoned'])
  })
})
