import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { asCampaignId } from '@core/ids'

import { useLocationStore } from './store'

describe('useLocationStore', () => {
  const camp = asCampaignId('camp_TESTABCDEF')

  beforeEach(() => {
    setActivePinia(createPinia())
    window.localStorage.clear()
  })

  it('starts empty', () => {
    const store = useLocationStore()
    expect(store.all).toEqual([])
  })

  it('creates a location', () => {
    const store = useLocationStore()
    const l = store.create({ campaignId: camp, name: 'A' })
    expect(store.byId(l.id)?.name).toBe('A')
  })

  it('treeFor returns nested structure', () => {
    const store = useLocationStore()
    const root = store.create({ campaignId: camp, name: 'Root' })
    store.create({ campaignId: camp, name: 'Child', parentId: root.id })
    const tree = store.treeFor(camp)
    expect(tree).toHaveLength(1)
    expect(tree[0]!.children).toHaveLength(1)
  })

  it('setVisited toggles', () => {
    const store = useLocationStore()
    const l = store.create({ campaignId: camp, name: 'X' })
    store.setVisited(l.id, true)
    expect(store.byId(l.id)?.visited).toBe(true)
  })

  it('setParent reparents', () => {
    const store = useLocationStore()
    const a = store.create({ campaignId: camp, name: 'A' })
    const b = store.create({ campaignId: camp, name: 'B' })
    store.setParent(b.id, a.id)
    expect(store.byId(b.id)?.parentId).toBe(a.id)
  })

  it('remove drops a leaf', () => {
    const store = useLocationStore()
    const l = store.create({ campaignId: camp, name: 'X' })
    store.remove(l.id)
    expect(store.byId(l.id)).toBe(null)
  })

  it('remove with cascade drops the subtree', () => {
    const store = useLocationStore()
    const r = store.create({ campaignId: camp, name: 'R' })
    const c = store.create({ campaignId: camp, name: 'C', parentId: r.id })
    store.remove(r.id, true)
    expect(store.byId(r.id)).toBe(null)
    expect(store.byId(c.id)).toBe(null)
  })
})
