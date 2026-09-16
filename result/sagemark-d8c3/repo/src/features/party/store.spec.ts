import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { asCampaignId, asCharacterId } from '@core/ids/brand'

import { usePartyStore } from './store'

const camp = asCampaignId('camp_X')
const a = asCharacterId('char_A')
const b = asCharacterId('char_B')

describe('usePartyStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    window.localStorage.clear()
  })

  it('returns an empty party for an unseen campaign', () => {
    const store = usePartyStore()
    const p = store.getParty(camp)
    expect(p.members).toEqual([])
    expect(p.motto).toBe('')
  })

  it('addMember appends only once', () => {
    const store = usePartyStore()
    store.addMember(camp, a)
    store.addMember(camp, a)
    expect(store.getParty(camp).members).toHaveLength(1)
  })

  it('removeMember drops it', () => {
    const store = usePartyStore()
    store.addMember(camp, a)
    store.removeMember(camp, a)
    expect(store.getParty(camp).members).toEqual([])
  })

  it('setStatus toggles between active and benched', () => {
    const store = usePartyStore()
    store.addMember(camp, a)
    store.setStatus(camp, a, 'benched')
    expect(store.getParty(camp).members[0]!.status).toBe('benched')
  })

  it('activeCount counts only active members', () => {
    const store = usePartyStore()
    store.addMember(camp, a)
    store.addMember(camp, b)
    store.setStatus(camp, b, 'absent')
    expect(store.activeCount(camp)).toBe(1)
  })

  it('setMotto and setSharedNotes save the values', () => {
    const store = usePartyStore()
    store.setMotto(camp, 'no one stands alone')
    store.setSharedNotes(camp, 'we owe the bell ringer')
    const p = store.getParty(camp)
    expect(p.motto).toBe('no one stands alone')
    expect(p.sharedNotes).toBe('we owe the bell ringer')
  })

  it('persists across re-init', () => {
    const first = usePartyStore()
    first.addMember(camp, a)
    first.setMotto(camp, 'persisted')
    setActivePinia(createPinia())
    const second = usePartyStore()
    expect(second.getParty(camp).members).toHaveLength(1)
    expect(second.getParty(camp).motto).toBe('persisted')
  })
})
