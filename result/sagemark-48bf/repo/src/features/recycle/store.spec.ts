import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { useRecycleStore } from './store'

describe('useRecycleStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    window.localStorage.clear()
  })

  it('starts empty', () => {
    expect(useRecycleStore().entries).toEqual([])
  })

  it('rememberDelete adds an entry with an expiry', () => {
    const store = useRecycleStore()
    const e = store.rememberDelete('character', { id: 'char_X', name: 'Iris' })
    expect(e.kind).toBe('character')
    expect(Date.parse(e.expiresAt)).toBeGreaterThan(Date.parse(e.deletedAt))
  })

  it('newest entries are first', () => {
    const store = useRecycleStore()
    const a = store.rememberDelete('faction', { id: 'fac_A' })
    const b = store.rememberDelete('lore', { id: 'lor_B' })
    expect(store.entries[0]?.id).toBe(b.id)
    expect(store.entries[1]?.id).toBe(a.id)
  })

  it('purge removes a specific entry', () => {
    const store = useRecycleStore()
    const e = store.rememberDelete('quest', { id: 'qst_X' })
    store.purge(e.id)
    expect(store.entries).toEqual([])
  })

  it('purgeAll wipes the bin', () => {
    const store = useRecycleStore()
    store.rememberDelete('character', { id: 'c1' })
    store.rememberDelete('faction', { id: 'f1' })
    expect(store.purgeAll()).toBe(2)
    expect(store.entries).toEqual([])
  })

  it('purgeExpired removes entries past expiry', () => {
    const store = useRecycleStore()
    store.setTtlDays(1)
    const e = store.rememberDelete('character', { id: 'old' })
    const later = new Date(Date.parse(e.expiresAt) + 60_000)
    const removed = store.purgeExpired(later)
    expect(removed).toBe(1)
    expect(store.entries).toEqual([])
  })

  it('forKind filters by kind', () => {
    const store = useRecycleStore()
    store.rememberDelete('character', { id: 'c1' })
    store.rememberDelete('faction', { id: 'f1' })
    expect(store.forKind('character')).toHaveLength(1)
  })

  it('setTtlDays clamps to a sane window', () => {
    const store = useRecycleStore()
    store.setTtlDays(0)
    expect(store.ttlDays).toBe(1)
    store.setTtlDays(9999)
    expect(store.ttlDays).toBe(365)
  })

  it('persists across re initialisation', () => {
    const a = useRecycleStore()
    a.rememberDelete('character', { id: 'persist' })
    setActivePinia(createPinia())
    const b = useRecycleStore()
    expect(b.entries).toHaveLength(1)
  })
})
