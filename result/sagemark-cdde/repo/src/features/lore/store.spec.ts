import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { asCampaignId } from '@core/ids'

import { useLoreStore } from './store'

describe('useLoreStore', () => {
  const camp = asCampaignId('camp_TEST123456')

  beforeEach(() => {
    setActivePinia(createPinia())
    window.localStorage.clear()
  })

  it('starts empty', () => {
    expect(useLoreStore().all).toEqual([])
  })

  it('creates and reads back', () => {
    const store = useLoreStore()
    const e = store.create({ campaignId: camp, title: 'X' })
    expect(store.byId(e.id)?.title).toBe('X')
  })

  it('setRevealed toggles', () => {
    const store = useLoreStore()
    const e = store.create({ campaignId: camp, title: 'X' })
    store.setRevealed(e.id, true)
    expect(store.byId(e.id)?.revealed).toBe(true)
  })

  it('setPinned toggles', () => {
    const store = useLoreStore()
    const e = store.create({ campaignId: camp, title: 'X' })
    store.setPinned(e.id, true)
    expect(store.byId(e.id)?.pinned).toBe(true)
  })

  it('search filters by query', () => {
    const store = useLoreStore()
    store.create({ campaignId: camp, title: 'Frozen Gate' })
    store.create({ campaignId: camp, title: 'Other' })
    expect(store.search(camp, 'frozen')).toHaveLength(1)
  })

  it('uniqueTagsFor returns sorted unique tags', () => {
    const store = useLoreStore()
    store.create({ campaignId: camp, title: 'A', tags: ['b', 'a'] })
    store.create({ campaignId: camp, title: 'B', tags: ['c', 'a'] })
    expect(store.uniqueTagsFor(camp)).toEqual(['a', 'b', 'c'])
  })

  it('remove drops the entry', () => {
    const store = useLoreStore()
    const e = store.create({ campaignId: camp, title: 'X' })
    store.remove(e.id)
    expect(store.byId(e.id)).toBe(null)
  })
})
