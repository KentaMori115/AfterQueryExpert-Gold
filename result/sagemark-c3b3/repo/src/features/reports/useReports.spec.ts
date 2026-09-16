import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { asCampaignId } from '@core/ids'
import { useCampaignStore } from '@features/campaigns/store'
import { useCharacterStore } from '@features/characters/store'
import { useFactionStore } from '@features/factions/store'
import { useQuestStore } from '@features/quests/store'
import { useSessionStore } from '@features/sessions/store'
import { useArcStore } from '@features/arcs/store'

import { useCampaignReports } from './useReports'

describe('useCampaignReports', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    window.localStorage.clear()
  })

  it('returns zeros when no campaign', () => {
    const r = useCampaignReports(() => null)
    expect(r.openQuestCount.value).toBe(0)
    expect(r.liveArcCount.value).toBe(0)
    expect(r.sessionsByMonth.value).toEqual([])
  })

  it('counts sessions per month chronologically', () => {
    const c = useCampaignStore().create({ name: 'X' })
    const s = useSessionStore()
    s.create({ campaignId: c.id, title: 'a', playedAt: '2025-03-01T20:00:00Z' })
    s.create({ campaignId: c.id, title: 'b', playedAt: '2025-03-15T20:00:00Z' })
    s.create({ campaignId: c.id, title: 'c', playedAt: '2025-04-01T20:00:00Z' })
    const r = useCampaignReports(() => asCampaignId(c.id))
    const keys = r.sessionsByMonth.value.map((m) => m.key)
    expect(keys).toEqual(['2025-03', '2025-04'])
    expect(r.sessionsByMonth.value[0]?.count).toBe(2)
  })

  it('orders factions by influence desc', () => {
    const c = useCampaignStore().create({ name: 'X' })
    const f = useFactionStore()
    f.create({ campaignId: c.id, name: 'low', influence: 10 })
    f.create({ campaignId: c.id, name: 'high', influence: 90 })
    const r = useCampaignReports(() => asCampaignId(c.id))
    expect(r.factionInfluence.value[0]?.name).toBe('high')
  })

  it('counts party composition by alive/fallen', () => {
    const c = useCampaignStore().create({ name: 'X' })
    const ch = useCharacterStore()
    ch.create({ campaignId: c.id, name: 'pc1', kind: 'pc' })
    ch.create({ campaignId: c.id, name: 'pc2', kind: 'pc' })
    ch.create({ campaignId: c.id, name: 'live', kind: 'npc' })
    ch.create({ campaignId: c.id, name: 'dead', kind: 'npc', alive: false })
    const r = useCampaignReports(() => asCampaignId(c.id))
    expect(r.partyComposition.value).toEqual({ pcs: 2, npcsAlive: 1, npcsFallen: 1 })
  })

  it('counts open quests', () => {
    const c = useCampaignStore().create({ name: 'X' })
    const q = useQuestStore()
    q.create({ campaignId: c.id, title: 'a' })
    q.create({ campaignId: c.id, title: 'b', status: 'completed' })
    const r = useCampaignReports(() => asCampaignId(c.id))
    expect(r.openQuestCount.value).toBe(1)
  })

  it('counts live arcs', () => {
    const c = useCampaignStore().create({ name: 'X' })
    const a = useArcStore()
    a.create({ campaignId: c.id, title: 'a', status: 'active' })
    a.create({ campaignId: c.id, title: 'b', status: 'resolved' })
    const r = useCampaignReports(() => asCampaignId(c.id))
    expect(r.liveArcCount.value).toBe(1)
  })
})
