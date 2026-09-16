import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { asCampaignId } from '@core/ids'

import { useHandoutStore } from './store'

describe('useHandoutStore', () => {
  const camp = asCampaignId('camp_TESTABCDEF')

  beforeEach(() => {
    setActivePinia(createPinia())
    window.localStorage.clear()
  })

  it('starts empty', () => {
    expect(useHandoutStore().forCampaign(camp)).toEqual([])
  })

  it('create adds a handout', () => {
    const store = useHandoutStore()
    const h = store.create({ campaignId: camp, title: 'Letter' })
    expect(store.byId(h.id)?.title).toBe('Letter')
  })

  it('share flips visibility and sharedAt', () => {
    const store = useHandoutStore()
    const h = store.create({ campaignId: camp, title: 'X' })
    const shared = store.share(h.id)
    expect(shared.visibility).toBe('shared')
    expect(shared.sharedAt).not.toBeNull()
  })

  it('unshare returns to draft', () => {
    const store = useHandoutStore()
    const h = store.create({ campaignId: camp, title: 'X', visibility: 'shared' })
    expect(store.unshare(h.id).visibility).toBe('draft')
  })

  it('archive sets archived visibility', () => {
    const store = useHandoutStore()
    const h = store.create({ campaignId: camp, title: 'X' })
    expect(store.archive(h.id).visibility).toBe('archived')
  })

  it('addRecipient and removeRecipient adjust the list', () => {
    const store = useHandoutStore()
    const h = store.create({ campaignId: camp, title: 'X' })
    const added = store.addRecipient(h.id, 'Iris')
    expect(added.recipients).toEqual(['Iris'])
    const removed = store.removeRecipient(h.id, 'iris')
    expect(removed.recipients).toEqual([])
  })

  it('byVisibility filters appropriately', () => {
    const store = useHandoutStore()
    store.create({ campaignId: camp, title: 'A' })
    store.create({ campaignId: camp, title: 'B', visibility: 'shared' })
    expect(store.byVisibility(camp, 'shared')).toHaveLength(1)
  })

  it('forRecipient pulls relevant handouts', () => {
    const store = useHandoutStore()
    store.create({ campaignId: camp, title: 'A', recipients: ['Iris'] })
    store.create({ campaignId: camp, title: 'B', recipients: ['Brann'] })
    expect(store.forRecipient(camp, 'Iris')).toHaveLength(1)
  })

  it('remove deletes a handout', () => {
    const store = useHandoutStore()
    const h = store.create({ campaignId: camp, title: 'X' })
    store.remove(h.id)
    expect(store.byId(h.id)).toBe(null)
  })

  it('version bumps after a mutation', () => {
    const store = useHandoutStore()
    const before = store.version
    store.create({ campaignId: camp, title: 'X' })
    expect(store.version).toBe(before + 1)
  })
})
