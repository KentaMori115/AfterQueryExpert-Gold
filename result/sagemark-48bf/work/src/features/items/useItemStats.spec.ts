import { defineComponent } from 'vue'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { asCampaignId, asCharacterId } from '@core/ids/brand'

import { useItemStore } from './store'
import {
  type CampaignItemStats,
  itemsForCharacter,
  rarityCountsFor,
  useItemStats,
} from './useItemStats'

const camp = asCampaignId('camp_X')
const ada = asCharacterId('char_A')
const ben = asCharacterId('char_B')

function harness(campaignId: () => string | null) {
  const Harness = defineComponent({
    setup(_, { expose }) {
      const r = useItemStats({
        campaignId: () => {
          const cid = campaignId()
          return cid ? (cid as never) : null
        },
      })
      expose({ stats: r.stats })
      return () => null
    },
  })
  return mount(Harness)
}

function api(wrapper: ReturnType<typeof harness>): { stats: CampaignItemStats | null } {
  return wrapper.vm as unknown as { stats: CampaignItemStats | null }
}

describe('useItemStats', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    window.localStorage.clear()
  })

  it('returns null when no campaign', () => {
    expect(api(harness(() => null)).stats).toBeNull()
  })

  it('counts unclaimed, magical and rarity buckets', () => {
    const items = useItemStore()
    items.create({ campaignId: camp, name: 'A', rarity: 'common' })
    items.create({ campaignId: camp, name: 'B', rarity: 'rare', magical: true })
    items.create({ campaignId: camp, name: 'C', rarity: 'rare' })
    const stats = api(harness(() => camp)).stats!
    expect(stats.total).toBe(3)
    expect(stats.unclaimed).toBe(3)
    expect(stats.magical).toBe(1)
    expect(stats.byRarity.rare).toBe(2)
  })

  it('topOwner reports who carries the most', () => {
    const items = useItemStore()
    const a = items.create({ campaignId: camp, name: 'A' })
    const b = items.create({ campaignId: camp, name: 'B' })
    const c = items.create({ campaignId: camp, name: 'C' })
    items.giveTo(a.id, ada)
    items.giveTo(b.id, ada)
    items.giveTo(c.id, ben)
    const stats = api(harness(() => camp)).stats!
    expect(stats.topOwner?.characterId).toBe(ada)
    expect(stats.topOwner?.count).toBe(2)
  })

  it('averageValue rounds across the list', () => {
    const items = useItemStore()
    items.create({ campaignId: camp, name: 'A', valueGp: 10 })
    items.create({ campaignId: camp, name: 'B', valueGp: 30 })
    const stats = api(harness(() => camp)).stats!
    expect(stats.averageValue).toBe(20)
  })
})

describe('per character helpers', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    window.localStorage.clear()
  })

  it('itemsForCharacter filters by owner', () => {
    const items = useItemStore()
    const a = items.create({ campaignId: camp, name: 'A' })
    items.giveTo(a.id, ada)
    expect(itemsForCharacter(camp, ada)).toHaveLength(1)
    expect(itemsForCharacter(camp, ben)).toHaveLength(0)
  })

  it('rarityCountsFor counts per character', () => {
    const items = useItemStore()
    const a = items.create({ campaignId: camp, name: 'A', rarity: 'common' })
    const b = items.create({ campaignId: camp, name: 'B', rarity: 'rare' })
    items.giveTo(a.id, ada)
    items.giveTo(b.id, ada)
    expect(rarityCountsFor(camp, ada).common).toBe(1)
    expect(rarityCountsFor(camp, ada).rare).toBe(1)
  })
})
