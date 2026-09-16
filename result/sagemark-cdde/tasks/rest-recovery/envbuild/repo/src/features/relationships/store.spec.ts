import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { asCampaignId, asCharacterId, asFactionId } from '@core/ids'

import { useRelationshipStore } from './store'

describe('useRelationshipStore', () => {
  const camp = asCampaignId('camp_TEST123456')
  const cA = asCharacterId('char_A0000000')
  const cB = asCharacterId('char_B0000000')
  const fX = asFactionId('fac_X0000000')

  beforeEach(() => {
    setActivePinia(createPinia())
    window.localStorage.clear()
  })

  it('starts empty', () => {
    expect(useRelationshipStore().all).toEqual([])
  })

  it('creates and reads back', () => {
    const store = useRelationshipStore()
    const r = store.create({
      campaignId: camp,
      from: { kind: 'character', id: cA },
      to: { kind: 'character', id: cB },
    })
    expect(store.byId(r.id)?.kind).toBe('unknown')
  })

  it('forNode finds edges touching the node', () => {
    const store = useRelationshipStore()
    store.create({
      campaignId: camp,
      from: { kind: 'character', id: cA },
      to: { kind: 'character', id: cB },
    })
    store.create({
      campaignId: camp,
      from: { kind: 'character', id: cA },
      to: { kind: 'faction', id: fX },
    })
    const edges = store.forNode(camp, { kind: 'character', id: cA })
    expect(edges).toHaveLength(2)
  })

  it('removeAllInvolving drops edges touching the node', () => {
    const store = useRelationshipStore()
    store.create({
      campaignId: camp,
      from: { kind: 'character', id: cA },
      to: { kind: 'character', id: cB },
    })
    store.create({
      campaignId: camp,
      from: { kind: 'character', id: cB },
      to: { kind: 'faction', id: fX },
    })
    expect(store.removeAllInvolving(camp, { kind: 'character', id: cA })).toBe(1)
    expect(store.all).toHaveLength(1)
  })

  it('remove drops one edge', () => {
    const store = useRelationshipStore()
    const r = store.create({
      campaignId: camp,
      from: { kind: 'character', id: cA },
      to: { kind: 'character', id: cB },
    })
    store.remove(r.id)
    expect(store.byId(r.id)).toBe(null)
  })
})
