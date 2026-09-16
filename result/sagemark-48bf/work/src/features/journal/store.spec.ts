import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { asCampaignId } from '@core/ids/brand'

import { JournalValidationError, useJournalStore } from './store'

const camp = asCampaignId('camp_X')

describe('useJournalStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    window.localStorage.clear()
  })

  it('creates an entry and exposes it via all', () => {
    const store = useJournalStore()
    store.create({ campaignId: camp, title: 'Note', body: 'pre session jitters' })
    expect(store.all).toHaveLength(1)
  })

  it('rejects bad drafts', () => {
    const store = useJournalStore()
    expect(() => store.create({ title: '   ', body: 'x' })).toThrow(JournalValidationError)
  })

  it('forCampaign filters by campaign or null for global', () => {
    const store = useJournalStore()
    store.create({ campaignId: camp, title: 'Camp', body: 'b' })
    store.create({ campaignId: null, title: 'Global', body: 'b' })
    expect(store.forCampaign(camp)).toHaveLength(1)
    expect(store.forCampaign(null)).toHaveLength(1)
  })

  it('togglePin moves the entry above non pinned', () => {
    const store = useJournalStore()
    const a = store.create({ campaignId: camp, title: 'A', body: 'a' })
    const b = store.create({ campaignId: camp, title: 'B', body: 'b' })
    store.togglePin(a.id)
    expect(store.all.map((e) => e.id)).toEqual([a.id, b.id])
  })

  it('update changes the body and mood', () => {
    const store = useJournalStore()
    const a = store.create({ campaignId: camp, title: 'A', body: 'a' })
    store.update(a.id, { campaignId: camp, title: 'A2', body: 'a2', mood: 'inspired' })
    expect(store.byId(a.id)!.body).toBe('a2')
    expect(store.byId(a.id)!.mood).toBe('inspired')
  })

  it('streakFor returns the mood when three in a row match', () => {
    const store = useJournalStore()
    store.create({ campaignId: camp, title: 'A', body: 'a', mood: 'tired' })
    store.create({ campaignId: camp, title: 'B', body: 'b', mood: 'tired' })
    store.create({ campaignId: camp, title: 'C', body: 'c', mood: 'tired' })
    expect(store.streakFor(camp)).toBe('tired')
  })

  it('persists across re-init', () => {
    const first = useJournalStore()
    first.create({ campaignId: camp, title: 'A', body: 'a' })
    setActivePinia(createPinia())
    const second = useJournalStore()
    expect(second.all).toHaveLength(1)
  })
})
