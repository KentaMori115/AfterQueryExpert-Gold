import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { asCampaignId, asCharacterId } from '@core/ids'

import { useItemStore } from './store'

describe('useItemStore', () => {
  const camp = asCampaignId('camp_TEST123456')
  const owner = asCharacterId('char_OWNER00000')

  beforeEach(() => {
    setActivePinia(createPinia())
    window.localStorage.clear()
  })

  it('starts empty', () => {
    expect(useItemStore().all).toEqual([])
  })

  it('creates and reads back', () => {
    const store = useItemStore()
    const i = store.create({ campaignId: camp, name: 'Sword' })
    expect(store.byId(i.id)?.name).toBe('Sword')
  })

  it('unownedFor / ownedBy partition', () => {
    const store = useItemStore()
    store.create({ campaignId: camp, name: 'a' })
    store.create({ campaignId: camp, name: 'b', ownerId: owner })
    expect(store.unownedFor(camp)).toHaveLength(1)
    expect(store.ownedBy(owner)).toHaveLength(1)
  })

  it('giveTo sets owner', () => {
    const store = useItemStore()
    const i = store.create({ campaignId: camp, name: 'X' })
    store.giveTo(i.id, owner)
    expect(store.byId(i.id)?.ownerId).toBe(owner)
  })

  it('giveTo to null clears attunement', () => {
    const store = useItemStore()
    const i = store.create({ campaignId: camp, name: 'X', magical: true, ownerId: owner, attuned: true })
    store.giveTo(i.id, null)
    expect(store.byId(i.id)?.attuned).toBe(false)
  })

  it('totalValueFor sums', () => {
    const store = useItemStore()
    store.create({ campaignId: camp, name: 'a', valueGp: 100 })
    store.create({ campaignId: camp, name: 'b', valueGp: 250 })
    expect(store.totalValueFor(camp)).toBe(350)
  })

  it('remove drops the item', () => {
    const store = useItemStore()
    const i = store.create({ campaignId: camp, name: 'X' })
    store.remove(i.id)
    expect(store.byId(i.id)).toBe(null)
  })
})
