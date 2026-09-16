import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { asCampaignId } from '@core/ids'
import { useCampaignStore } from '@features/campaigns/store'
import { useCharacterStore } from '@features/characters/store'
import { useFactionStore } from '@features/factions/store'
import { useLoreStore } from '@features/lore/store'
import { useQuestStore } from '@features/quests/store'

import { useGlobalSearch } from './useGlobalSearch'

describe('useGlobalSearch', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    window.localStorage.clear()
  })

  it('returns nothing for empty query', () => {
    const { query, results } = useGlobalSearch(() => null)
    query.value = ''
    expect(results.value).toEqual([])
  })

  it('returns nothing when there is no campaign', () => {
    const { query, results } = useGlobalSearch(() => null)
    query.value = 'frost'
    expect(results.value).toEqual([])
  })

  it('matches characters by name', () => {
    const c = useCampaignStore().create({ name: 'X' })
    const chStore = useCharacterStore()
    chStore.create({ campaignId: c.id, name: 'Iris Thorne' })
    chStore.create({ campaignId: c.id, name: 'Brann' })
    const { query, grouped } = useGlobalSearch(() => asCampaignId(c.id))
    query.value = 'iris'
    expect(grouped.value.character).toHaveLength(1)
  })

  it('matches factions by motto', () => {
    const c = useCampaignStore().create({ name: 'X' })
    const fStore = useFactionStore()
    fStore.create({ campaignId: c.id, name: 'Iron Hand', motto: 'For order' })
    const { query, grouped } = useGlobalSearch(() => asCampaignId(c.id))
    query.value = 'order'
    expect(grouped.value.faction).toHaveLength(1)
  })

  it('matches lore by tag', () => {
    const c = useCampaignStore().create({ name: 'X' })
    const lStore = useLoreStore()
    lStore.create({ campaignId: c.id, title: 'irrelevant', tags: ['frost'] })
    const { query, grouped } = useGlobalSearch(() => asCampaignId(c.id))
    query.value = 'frost'
    expect(grouped.value.lore).toHaveLength(1)
  })

  it('matches quests by title', () => {
    const c = useCampaignStore().create({ name: 'X' })
    const qStore = useQuestStore()
    qStore.create({ campaignId: c.id, title: 'Find the cat' })
    const { query, grouped } = useGlobalSearch(() => asCampaignId(c.id))
    query.value = 'cat'
    expect(grouped.value.quest).toHaveLength(1)
  })

  it('is case insensitive', () => {
    const c = useCampaignStore().create({ name: 'X' })
    useCharacterStore().create({ campaignId: c.id, name: 'IRIS' })
    const { query, grouped } = useGlobalSearch(() => asCampaignId(c.id))
    query.value = 'iris'
    expect(grouped.value.character).toHaveLength(1)
  })
})
