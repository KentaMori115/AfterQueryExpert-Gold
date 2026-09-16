import { defineComponent } from 'vue'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { asCampaignId, asCharacterId, asFactionId } from '@core/ids/brand'

import { useTagStore } from './store'
import { useTagStats, type TagStats } from './useTagStats'

const camp = asCampaignId('camp_X')

function harness(campaignId: () => string | null) {
  const Harness = defineComponent({
    setup(_, { expose }) {
      const r = useTagStats({
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

function api(wrapper: ReturnType<typeof harness>): { stats: TagStats | null } {
  return wrapper.vm as unknown as { stats: TagStats | null }
}

describe('useTagStats', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    window.localStorage.clear()
  })

  it('returns null when no campaign id', () => {
    const w = harness(() => null)
    expect(api(w).stats).toBeNull()
  })

  it('reports zero stats when no tags exist', () => {
    const w = harness(() => camp)
    expect(api(w).stats!.total).toBe(0)
    expect(api(w).stats!.unused).toBe(0)
    expect(api(w).stats!.averageTargetsPerTag).toBe(0)
  })

  it('counts unused and most used tags', () => {
    const tags = useTagStore()
    const heavy = tags.create({ campaignId: camp, name: 'Heavy' })
    const light = tags.create({ campaignId: camp, name: 'Light' })
    void light
    tags.attach(heavy.id, 'character', asCharacterId('c1'))
    tags.attach(heavy.id, 'character', asCharacterId('c2'))
    const w = harness(() => camp)
    const stats = api(w).stats!
    expect(stats.total).toBe(2)
    expect(stats.unused).toBe(1)
    expect(stats.mostUsed?.tag.slug).toBe('heavy')
  })

  it('tallies usage per kind', () => {
    const tags = useTagStore()
    const tag = tags.create({ campaignId: camp, name: 'Iron' })
    tags.attach(tag.id, 'character', asCharacterId('c1'))
    tags.attach(tag.id, 'character', asCharacterId('c2'))
    tags.attach(tag.id, 'faction', asFactionId('f1'))
    const w = harness(() => camp)
    expect(api(w).stats!.byKind.character).toBe(2)
    expect(api(w).stats!.byKind.faction).toBe(1)
    expect(api(w).stats!.averageTargetsPerTag).toBe(3)
  })
})
