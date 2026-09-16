import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { asCampaignId, asCharacterId } from '@core/ids'

import { useXpStore } from './store'

describe('useXpStore', () => {
  const camp = asCampaignId('camp_TESTABCDEF')
  const charA = asCharacterId('char_A0000000')
  const charB = asCharacterId('char_B0000000')

  beforeEach(() => {
    setActivePinia(createPinia())
    window.localStorage.clear()
  })

  it('starts with empty history for any character', () => {
    const store = useXpStore()
    expect(store.forCharacter(charA)).toEqual([])
  })

  it('recordAward returns an entry and totals update', () => {
    const store = useXpStore()
    const e = store.recordAward({ campaignId: camp, characterId: charA, amount: 100 })
    expect(e.kind).toBe('award')
    expect(store.totalFor(charA)).toBe(100)
  })

  it('recordDeduct reduces totals', () => {
    const store = useXpStore()
    store.recordAward({ campaignId: camp, characterId: charA, amount: 200 })
    store.recordDeduct({ campaignId: camp, characterId: charA, amount: 50 })
    expect(store.totalFor(charA)).toBe(150)
  })

  it('recordMilestone counts as positive xp', () => {
    const store = useXpStore()
    store.recordMilestone({ campaignId: camp, characterId: charA, amount: 500 })
    expect(store.totalFor(charA)).toBe(500)
  })

  it('forCampaign returns entries scoped to the campaign', () => {
    const store = useXpStore()
    store.recordAward({ campaignId: camp, characterId: charA, amount: 100 })
    expect(store.forCampaign(camp)).toHaveLength(1)
  })

  it('removeAllForCharacter clears a single character', () => {
    const store = useXpStore()
    store.recordAward({ campaignId: camp, characterId: charA, amount: 100 })
    store.recordAward({ campaignId: camp, characterId: charB, amount: 100 })
    expect(store.removeAllForCharacter(charA)).toBe(1)
    expect(store.forCharacter(charA)).toEqual([])
    expect(store.forCharacter(charB)).toHaveLength(1)
  })

  it('remove drops a specific entry', () => {
    const store = useXpStore()
    const e = store.recordAward({ campaignId: camp, characterId: charA, amount: 100 })
    store.remove(e.id)
    expect(store.forCharacter(charA)).toEqual([])
  })

  it('version bumps after a mutation', () => {
    const store = useXpStore()
    const before = store.version
    store.recordAward({ campaignId: camp, characterId: charA, amount: 1 })
    expect(store.version).toBe(before + 1)
  })
})
