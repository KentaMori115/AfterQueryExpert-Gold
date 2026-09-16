import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { asCampaignId, asSessionId } from '@core/ids'

import { useEncounterStore } from './store'

describe('useEncounterStore', () => {
  const camp = asCampaignId('camp_TEST123456')
  const ses = asSessionId('ses_TESTABCDEF')

  beforeEach(() => {
    setActivePinia(createPinia())
    window.localStorage.clear()
  })

  it('starts empty', () => {
    expect(useEncounterStore().all).toEqual([])
  })

  it('creates and reads back', () => {
    const store = useEncounterStore()
    const e = store.create({ campaignId: camp, title: 'X' })
    expect(store.byId(e.id)?.title).toBe('X')
  })

  it('unresolvedFor filters', () => {
    const store = useEncounterStore()
    store.create({ campaignId: camp, title: 'a' })
    store.create({ campaignId: camp, title: 'b', resolved: true })
    expect(store.unresolvedFor(camp)).toHaveLength(1)
  })

  it('forSession filters', () => {
    const store = useEncounterStore()
    store.create({ campaignId: camp, title: 'x', sessionId: ses })
    store.create({ campaignId: camp, title: 'y' })
    expect(store.forSession(ses)).toHaveLength(1)
  })

  it('setInitiative replaces', () => {
    const store = useEncounterStore()
    const e = store.create({ campaignId: camp, title: 'X' })
    store.setInitiative(e.id, [
      { characterId: null, name: 'goblin', initiative: 10, hp: 5, notes: '' },
    ])
    expect(store.byId(e.id)?.initiative).toHaveLength(1)
  })

  it('markResolved toggles', () => {
    const store = useEncounterStore()
    const e = store.create({ campaignId: camp, title: 'X' })
    store.markResolved(e.id, true)
    expect(store.byId(e.id)?.resolved).toBe(true)
  })

  it('remove drops', () => {
    const store = useEncounterStore()
    const e = store.create({ campaignId: camp, title: 'X' })
    store.remove(e.id)
    expect(store.byId(e.id)).toBe(null)
  })
})
