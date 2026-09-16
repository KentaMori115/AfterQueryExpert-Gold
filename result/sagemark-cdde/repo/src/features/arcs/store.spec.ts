import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { asCampaignId } from '@core/ids'

import { useArcStore } from './store'

describe('useArcStore', () => {
  const camp = asCampaignId('camp_TEST123456')
  const other = asCampaignId('camp_OTHER12345')

  beforeEach(() => {
    setActivePinia(createPinia())
    window.localStorage.clear()
  })

  it('starts empty', () => {
    expect(useArcStore().all).toEqual([])
  })

  it('creates an arc', () => {
    const store = useArcStore()
    const a = store.create({ campaignId: camp, title: 'X' })
    expect(store.byId(a.id)?.title).toBe('X')
  })

  it('groupedByStatus contains every status as a key', () => {
    const store = useArcStore()
    store.create({ campaignId: camp, title: 'A', status: 'active' })
    store.create({ campaignId: camp, title: 'R', status: 'resolved' })
    const grouped = store.groupedByStatus(camp)
    expect(Object.keys(grouped).sort()).toEqual(['active', 'climbing', 'resolved', 'seeded', 'shelved'])
    expect(grouped.active).toHaveLength(1)
    expect(grouped.resolved).toHaveLength(1)
    expect(grouped.seeded).toEqual([])
  })

  it('liveCountFor excludes resolved + shelved', () => {
    const store = useArcStore()
    store.create({ campaignId: camp, title: 'A', status: 'active' })
    store.create({ campaignId: camp, title: 'R', status: 'resolved' })
    store.create({ campaignId: camp, title: 'S', status: 'shelved' })
    expect(store.liveCountFor(camp)).toBe(1)
  })

  it('setStatus moves between columns', () => {
    const store = useArcStore()
    const a = store.create({ campaignId: camp, title: 'X', status: 'active' })
    store.setStatus(a.id, 'climbing')
    expect(store.byId(a.id)?.status).toBe('climbing')
  })

  it('setTension changes the tension', () => {
    const store = useArcStore()
    const a = store.create({ campaignId: camp, title: 'X' })
    store.setTension(a.id, 'breaking')
    expect(store.byId(a.id)?.tension).toBe('breaking')
  })

  it('remove drops the arc', () => {
    const store = useArcStore()
    const a = store.create({ campaignId: camp, title: 'X' })
    store.remove(a.id)
    expect(store.byId(a.id)).toBe(null)
  })

  it('removeAllForCampaign only affects that campaign', () => {
    const store = useArcStore()
    store.create({ campaignId: camp, title: 'A' })
    store.create({ campaignId: other, title: 'B' })
    expect(store.removeAllForCampaign(camp)).toBe(1)
    expect(store.forCampaign(other)).toHaveLength(1)
  })
})
