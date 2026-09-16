import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { asCampaignId, asCharacterId } from '@core/ids/brand'

import { useDowntimeStore } from './store'

const camp = asCampaignId('camp_X')
const charA = asCharacterId('char_A')
const charB = asCharacterId('char_B')

describe('useDowntimeStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    window.localStorage.clear()
  })

  it('creates and lists activities by campaign', () => {
    const store = useDowntimeStore()
    store.create({ campaignId: camp, characterId: charA, kind: 'crafting' })
    expect(store.forCampaign(camp)).toHaveLength(1)
    expect(store.total).toBe(1)
  })

  it('forCharacter filters down to one character', () => {
    const store = useDowntimeStore()
    store.create({ campaignId: camp, characterId: charA, kind: 'crafting' })
    store.create({ campaignId: camp, characterId: charB, kind: 'research' })
    expect(store.forCharacter(camp, charA)).toHaveLength(1)
    expect(store.forCharacter(camp, charB)).toHaveLength(1)
  })

  it('setOutcome and setWeeks propagate to the store', () => {
    const store = useDowntimeStore()
    const a = store.create({ campaignId: camp, characterId: charA, kind: 'training' })
    store.setOutcome(a.id, 'underway')
    store.setWeeks(a.id, 6)
    const reloaded = store.byId(a.id)
    expect(reloaded?.outcome).toBe('underway')
    expect(reloaded?.weeks).toBe(6)
  })

  it('remove drops a single activity', () => {
    const store = useDowntimeStore()
    const a = store.create({ campaignId: camp, characterId: charA, kind: 'training' })
    store.remove(a.id)
    expect(store.byId(a.id)).toBeNull()
  })

  it('removeAllForCharacter clears just that character', () => {
    const store = useDowntimeStore()
    store.create({ campaignId: camp, characterId: charA, kind: 'training' })
    store.create({ campaignId: camp, characterId: charA, kind: 'crafting' })
    store.create({ campaignId: camp, characterId: charB, kind: 'research' })
    const removed = store.removeAllForCharacter(camp, charA)
    expect(removed).toBe(2)
    expect(store.forCharacter(camp, charA)).toEqual([])
    expect(store.forCharacter(camp, charB)).toHaveLength(1)
  })

  it('persists across re-init', () => {
    const first = useDowntimeStore()
    first.create({ campaignId: camp, characterId: charA, kind: 'training' })
    setActivePinia(createPinia())
    const second = useDowntimeStore()
    expect(second.forCharacter(camp, charA)).toHaveLength(1)
  })
})
