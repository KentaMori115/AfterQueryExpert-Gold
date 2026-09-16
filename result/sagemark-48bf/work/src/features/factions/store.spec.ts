import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { asCampaignId, asCharacterId } from '@core/ids'

import { useFactionStore } from './store'

describe('useFactionStore', () => {
  const camp = asCampaignId('camp_TESTABCDEF')
  const other = asCampaignId('camp_OTHER12345')

  beforeEach(() => {
    setActivePinia(createPinia())
    window.localStorage.clear()
  })

  it('starts empty', () => {
    const store = useFactionStore()
    expect(store.all).toEqual([])
    expect(store.total).toBe(0)
  })

  it('creates a faction', () => {
    const store = useFactionStore()
    const f = store.create({ campaignId: camp, name: 'X' })
    expect(store.byId(f.id)?.name).toBe('X')
  })

  it('forCampaign/activeFor partition correctly', () => {
    const store = useFactionStore()
    store.create({ campaignId: camp, name: 'A' })
    const off = store.create({ campaignId: camp, name: 'B', active: false })
    store.create({ campaignId: other, name: 'C' })
    expect(store.forCampaign(camp)).toHaveLength(2)
    expect(store.activeFor(camp)).toHaveLength(1)
    expect(store.activeFor(camp).find((f) => f.id === off.id)).toBeUndefined()
  })

  it('adjustInfluence updates the faction', () => {
    const store = useFactionStore()
    const f = store.create({ campaignId: camp, name: 'X', influence: 30 })
    store.adjustInfluence(f.id, 25)
    expect(store.byId(f.id)?.influence).toBe(55)
  })

  it('setActive toggles', () => {
    const store = useFactionStore()
    const f = store.create({ campaignId: camp, name: 'X' })
    store.setActive(f.id, false)
    expect(store.byId(f.id)?.active).toBe(false)
  })

  it('setLeader sets the leader id', () => {
    const store = useFactionStore()
    const f = store.create({ campaignId: camp, name: 'X' })
    const leader = asCharacterId('char_LEADERXXXX')
    store.setLeader(f.id, leader)
    expect(store.byId(f.id)?.leaderId).toBe(leader)
  })

  it('remove drops the faction', () => {
    const store = useFactionStore()
    const f = store.create({ campaignId: camp, name: 'X' })
    store.remove(f.id)
    expect(store.byId(f.id)).toBe(null)
  })

  it('removeAllForCampaign clears just that campaign', () => {
    const store = useFactionStore()
    store.create({ campaignId: camp, name: 'A' })
    store.create({ campaignId: camp, name: 'B' })
    store.create({ campaignId: other, name: 'C' })
    expect(store.removeAllForCampaign(camp)).toBe(2)
    expect(store.forCampaign(other)).toHaveLength(1)
  })
})
