import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { asCampaignId } from '@core/ids/brand'

import { useTagStore } from './store'

const camp = asCampaignId('camp_X')

describe('useTagStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    window.localStorage.clear()
  })

  it('creates a tag and lists it under the campaign', () => {
    const store = useTagStore()
    const created = store.create({ campaignId: camp, name: 'Iron Banner' })
    expect(created.slug).toBe('iron-banner')
    expect(store.forCampaign(camp)).toHaveLength(1)
    expect(store.total).toBe(1)
  })

  it('keeps each campaign in its own bucket', () => {
    const store = useTagStore()
    store.create({ campaignId: camp, name: 'Iron Banner' })
    store.create({ campaignId: asCampaignId('camp_Y'), name: 'Sea Wolves' })
    expect(store.forCampaign(camp)).toHaveLength(1)
    expect(store.forCampaign(asCampaignId('camp_Y'))).toHaveLength(1)
  })

  it('attaches and detaches a target', () => {
    const store = useTagStore()
    const t = store.create({ campaignId: camp, name: 'Iron' })
    store.attach(t.id, 'character', 'char_1')
    expect(store.forTarget(camp, 'character', 'char_1')).toHaveLength(1)
    store.detach(t.id, 'character', 'char_1')
    expect(store.forTarget(camp, 'character', 'char_1')).toHaveLength(0)
  })

  it('detachTarget unhooks every tag pointing at a target', () => {
    const store = useTagStore()
    const a = store.create({ campaignId: camp, name: 'Iron' })
    const b = store.create({ campaignId: camp, name: 'Bound' })
    store.attach(a.id, 'faction', 'fac_1')
    store.attach(b.id, 'faction', 'fac_1')
    const removed = store.detachTarget(camp, 'faction', 'fac_1')
    expect(removed).toBe(2)
    expect(store.forTarget(camp, 'faction', 'fac_1')).toHaveLength(0)
  })

  it('rename and setTone propagate', () => {
    const store = useTagStore()
    const t = store.create({ campaignId: camp, name: 'Iron' })
    store.rename(t.id, 'Iron Circle')
    store.setTone(t.id, 'crimson')
    const refreshed = store.byId(t.id)
    expect(refreshed?.name).toBe('Iron Circle')
    expect(refreshed?.tone).toBe('crimson')
  })

  it('orders forCampaign by usage count then name', () => {
    const store = useTagStore()
    const heavy = store.create({ campaignId: camp, name: 'Heavy' })
    const light = store.create({ campaignId: camp, name: 'Light' })
    store.attach(heavy.id, 'character', 'a')
    store.attach(heavy.id, 'character', 'b')
    store.attach(light.id, 'character', 'a')
    expect(store.forCampaign(camp).map((t) => t.slug)).toEqual(['heavy', 'light'])
  })

  it('persists across re-init via the underlying repo', () => {
    const first = useTagStore()
    first.create({ campaignId: camp, name: 'Iron' })
    setActivePinia(createPinia())
    const second = useTagStore()
    expect(second.forCampaign(camp).map((t) => t.slug)).toEqual(['iron'])
  })

  it('removeAllForCampaign clears the campaign', () => {
    const store = useTagStore()
    store.create({ campaignId: camp, name: 'A' })
    store.create({ campaignId: camp, name: 'B' })
    const removed = store.removeAllForCampaign(camp)
    expect(removed).toBe(2)
    expect(store.forCampaign(camp)).toEqual([])
  })
})
