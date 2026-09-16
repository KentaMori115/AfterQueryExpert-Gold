import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { asCampaignId } from '@core/ids'

import { useCharacterStore } from './store'

describe('useCharacterStore', () => {
  const camp = asCampaignId('camp_FROZEN1234')
  const other = asCampaignId('camp_OTHER12345')

  beforeEach(() => {
    setActivePinia(createPinia())
    window.localStorage.clear()
  })

  it('starts empty', () => {
    const store = useCharacterStore()
    expect(store.all).toEqual([])
    expect(store.total).toBe(0)
  })

  it('creates a character scoped to a campaign', () => {
    const store = useCharacterStore()
    const c = store.create({ campaignId: camp, name: 'Iris' })
    expect(store.all).toHaveLength(1)
    expect(store.forCampaign(camp)).toHaveLength(1)
    expect(store.forCampaign(other)).toHaveLength(0)
    expect(c.campaignId).toBe(camp)
  })

  it('pcsFor / npcsFor partition by kind', () => {
    const store = useCharacterStore()
    store.create({ campaignId: camp, name: 'A', kind: 'pc' })
    store.create({ campaignId: camp, name: 'B', kind: 'npc' })
    store.create({ campaignId: camp, name: 'C', kind: 'npc' })
    expect(store.pcsFor(camp).map((c) => c.name)).toEqual(['A'])
    expect(store.npcsFor(camp).map((c) => c.name).sort()).toEqual(['B', 'C'])
  })

  it('byId finds the character', () => {
    const store = useCharacterStore()
    const c = store.create({ campaignId: camp, name: 'X' })
    expect(store.byId(c.id)?.name).toBe('X')
  })

  it('returns null for unknown ids', () => {
    const store = useCharacterStore()
    expect(store.byId('char_NOPE000000' as never)).toBe(null)
  })

  it('update mutates fields', () => {
    const store = useCharacterStore()
    const c = store.create({ campaignId: camp, name: 'Old' })
    store.update(c.id, { campaignId: camp, name: 'New' })
    expect(store.byId(c.id)?.name).toBe('New')
  })

  it('setDisposition changes the disposition', () => {
    const store = useCharacterStore()
    const c = store.create({ campaignId: camp, name: 'X' })
    store.setDisposition(c.id, 'hostile')
    expect(store.byId(c.id)?.disposition).toBe('hostile')
  })

  it('markDeceased / revive toggles alive', () => {
    const store = useCharacterStore()
    const c = store.create({ campaignId: camp, name: 'X' })
    store.markDeceased(c.id)
    expect(store.byId(c.id)?.alive).toBe(false)
    store.revive(c.id)
    expect(store.byId(c.id)?.alive).toBe(true)
  })

  it('remove drops the character', () => {
    const store = useCharacterStore()
    const c = store.create({ campaignId: camp, name: 'X' })
    store.remove(c.id)
    expect(store.byId(c.id)).toBe(null)
  })

  it('removeAllForCampaign wipes just that campaign', () => {
    const store = useCharacterStore()
    store.create({ campaignId: camp, name: 'A' })
    store.create({ campaignId: camp, name: 'B' })
    store.create({ campaignId: other, name: 'C' })
    const removed = store.removeAllForCampaign(camp)
    expect(removed).toBe(2)
    expect(store.forCampaign(camp)).toEqual([])
    expect(store.forCampaign(other)).toHaveLength(1)
  })

  it('total reflects all characters across campaigns', () => {
    const store = useCharacterStore()
    store.create({ campaignId: camp, name: 'A' })
    store.create({ campaignId: other, name: 'B' })
    expect(store.total).toBe(2)
  })
})
