import { defineComponent } from 'vue'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { asCampaignId } from '@core/ids/brand'
import type { TagId } from '@core/ids'
import type { TagTargetKind } from '@core/models/tag'

import { useCampaignStore } from '@features/campaigns/store'
import { useCharacterStore } from '@features/characters/store'
import { useFactionStore } from '@features/factions/store'

import { useTagStore } from './store'
import { useTagFilter, type TagFilterMode, type TaggedTarget } from './useTagFilter'

interface Exposed {
  selected: ReadonlyArray<TagId>
  mode: TagFilterMode
  toggle: (id: TagId) => void
  clear: () => void
  setMode: (m: TagFilterMode) => void
  results: TaggedTarget[]
  totals: Record<TagTargetKind, number>
}

function harness(campaignId: () => string | null) {
  const Harness = defineComponent({
    setup(_, { expose }) {
      const r = useTagFilter({
        campaignId: () => {
          const cid = campaignId()
          return cid ? (cid as never) : null
        },
      })
      expose({
        selected: r.selected,
        mode: r.mode,
        toggle: r.toggle,
        clear: r.clear,
        setMode: (m: TagFilterMode) => {
          r.mode.value = m
        },
        results: r.results,
        totals: r.totals,
      })
      return () => null
    },
  })
  return mount(Harness)
}

function api(wrapper: ReturnType<typeof harness>): Exposed {
  return wrapper.vm as unknown as Exposed
}

void asCampaignId

describe('useTagFilter', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    window.localStorage.clear()
  })

  it('starts empty and yields no results until a tag is selected', () => {
    const camp = useCampaignStore().create({ name: 'F', summary: 's' })
    const w = harness(() => camp.id)
    expect(api(w).selected).toEqual([])
    expect(api(w).results).toEqual([])
  })

  it('returns characters tagged with a selected tag', async () => {
    const campaigns = useCampaignStore()
    const tags = useTagStore()
    const characters = useCharacterStore()
    const c = campaigns.create({ name: 'F', summary: 's' })
    const char = characters.create({ campaignId: c.id, name: 'Iris', kind: 'pc' })
    const tag = tags.create({ campaignId: c.id as never, name: 'Iron' })
    tags.attach(tag.id, 'character', char.id)
    const w = harness(() => c.id)
    api(w).toggle(tag.id as TagId)
    await w.vm.$nextTick()
    expect(api(w).results).toHaveLength(1)
    expect(api(w).results[0]!.name).toBe('Iris')
  })

  it('mode all keeps only hits that match every selected tag', async () => {
    const campaigns = useCampaignStore()
    const tags = useTagStore()
    const characters = useCharacterStore()
    const c = campaigns.create({ name: 'F', summary: 's' })
    const a = characters.create({ campaignId: c.id, name: 'Iris', kind: 'pc' })
    const b = characters.create({ campaignId: c.id, name: 'Brann', kind: 'pc' })
    const t1 = tags.create({ campaignId: c.id as never, name: 'Iron' })
    const t2 = tags.create({ campaignId: c.id as never, name: 'Bound' })
    tags.attach(t1.id, 'character', a.id)
    tags.attach(t2.id, 'character', a.id)
    tags.attach(t1.id, 'character', b.id)
    const w = harness(() => c.id)
    api(w).toggle(t1.id as TagId)
    api(w).toggle(t2.id as TagId)
    api(w).setMode('all')
    await w.vm.$nextTick()
    const names = api(w).results.map((r) => r.name)
    expect(names).toEqual(['Iris'])
  })

  it('mode any returns the union of hits', async () => {
    const campaigns = useCampaignStore()
    const tags = useTagStore()
    const characters = useCharacterStore()
    const c = campaigns.create({ name: 'F', summary: 's' })
    const a = characters.create({ campaignId: c.id, name: 'Iris', kind: 'pc' })
    const b = characters.create({ campaignId: c.id, name: 'Brann', kind: 'pc' })
    const t1 = tags.create({ campaignId: c.id as never, name: 'Iron' })
    const t2 = tags.create({ campaignId: c.id as never, name: 'Bound' })
    tags.attach(t1.id, 'character', a.id)
    tags.attach(t2.id, 'character', b.id)
    const w = harness(() => c.id)
    api(w).toggle(t1.id as TagId)
    api(w).toggle(t2.id as TagId)
    await w.vm.$nextTick()
    const names = api(w).results.map((r) => r.name).sort()
    expect(names).toEqual(['Brann', 'Iris'])
  })

  it('totals counts hits per kind', async () => {
    const campaigns = useCampaignStore()
    const tags = useTagStore()
    const characters = useCharacterStore()
    const factions = useFactionStore()
    const c = campaigns.create({ name: 'F', summary: 's' })
    const ch = characters.create({ campaignId: c.id, name: 'Iris', kind: 'pc' })
    const fa = factions.create({
      campaignId: c.id,
      name: 'Banner',
      alignment: 'neutral',
      scope: 'regional',
    })
    const tag = tags.create({ campaignId: c.id as never, name: 'Iron' })
    tags.attach(tag.id, 'character', ch.id)
    tags.attach(tag.id, 'faction', fa.id)
    const w = harness(() => c.id)
    api(w).toggle(tag.id as TagId)
    await w.vm.$nextTick()
    expect(api(w).totals.character).toBe(1)
    expect(api(w).totals.faction).toBe(1)
    expect(api(w).totals.location).toBe(0)
  })

  it('clear resets the selection', () => {
    const campaigns = useCampaignStore()
    const tags = useTagStore()
    const c = campaigns.create({ name: 'F', summary: 's' })
    const tag = tags.create({ campaignId: c.id as never, name: 'Iron' })
    const w = harness(() => c.id)
    api(w).toggle(tag.id as TagId)
    expect(api(w).selected).toHaveLength(1)
    api(w).clear()
    expect(api(w).selected).toEqual([])
  })
})
