import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { asCampaignId, asLocationId } from '@core/ids/brand'

import { useMapStore } from './store'

const camp = asCampaignId('camp_X')
const camp2 = asCampaignId('camp_Y')
const loc = asLocationId('loc_A')
const loc2 = asLocationId('loc_B')

describe('useMapStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    window.localStorage.clear()
  })

  it('returns null for unseen placements', () => {
    const store = useMapStore()
    expect(store.placement(camp, loc)).toBeNull()
  })

  it('placeAt rounds coordinates and persists', () => {
    const store = useMapStore()
    store.placeAt(camp, loc, 12.7, -4.3)
    const p = store.placement(camp, loc)!
    expect(p.x).toBe(13)
    expect(p.y).toBe(-4)
  })

  it('forCampaign filters out other campaigns', () => {
    const store = useMapStore()
    store.placeAt(camp, loc, 1, 1)
    store.placeAt(camp2, loc2, 2, 2)
    expect(store.forCampaign(camp)).toHaveLength(1)
  })

  it('remove drops a single placement', () => {
    const store = useMapStore()
    store.placeAt(camp, loc, 1, 1)
    store.remove(camp, loc)
    expect(store.placement(camp, loc)).toBeNull()
  })

  it('clearCampaign drops every placement under the campaign', () => {
    const store = useMapStore()
    store.placeAt(camp, loc, 1, 1)
    store.placeAt(camp, loc2, 2, 2)
    store.placeAt(camp2, loc, 3, 3)
    const removed = store.clearCampaign(camp)
    expect(removed).toBe(2)
    expect(store.forCampaign(camp)).toEqual([])
    expect(store.forCampaign(camp2)).toHaveLength(1)
  })

  it('persists across re-init', () => {
    const first = useMapStore()
    first.placeAt(camp, loc, 7, 8)
    setActivePinia(createPinia())
    const second = useMapStore()
    expect(second.placement(camp, loc)).toEqual({
      campaignId: camp,
      locationId: loc,
      x: 7,
      y: 8,
    })
  })
})
