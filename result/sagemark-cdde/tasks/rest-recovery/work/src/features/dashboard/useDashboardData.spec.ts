import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { useCampaignStore } from '@features/campaigns/store'
import { useCharacterStore } from '@features/characters/store'
import { useSessionStore } from '@features/sessions/store'
import { useArcStore } from '@features/arcs/store'
import { useQuestStore } from '@features/quests/store'

import { useDashboardData } from './useDashboardData'

describe('useDashboardData', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    window.localStorage.clear()
  })

  it('returns zeros when there are no campaigns', () => {
    const d = useDashboardData()
    expect(d.totalCampaigns.value).toBe(0)
    expect(d.openCampaigns.value).toBe(0)
    expect(d.summaries.value).toEqual([])
    expect(d.mostRecentCampaign.value).toBe(null)
  })

  it('rolls totals across campaigns', () => {
    const campaigns = useCampaignStore()
    const a = campaigns.create({ name: 'A', status: 'active' })
    const b = campaigns.create({ name: 'B', status: 'archived' })
    useCharacterStore().create({ campaignId: a.id, name: 'Iris' })
    useCharacterStore().create({ campaignId: b.id, name: 'Kael' })
    useSessionStore().create({ campaignId: a.id, title: 'one', playedAt: '2026-01-01T20:00:00Z' })
    useArcStore().create({ campaignId: a.id, title: 'Winter', status: 'active' })
    useQuestStore().create({ campaignId: a.id, title: 'find the cat' })

    const d = useDashboardData()
    expect(d.totalCampaigns.value).toBe(2)
    expect(d.openCampaigns.value).toBe(1)
    expect(d.totalCharacters.value).toBe(2)
    expect(d.totalSessions.value).toBe(1)
    expect(d.totalArcs.value).toBe(1)
    expect(d.totalQuests.value).toBe(1)
  })

  it('mostRecentCampaign prefers the one with newest lastPlayedAt', () => {
    const campaigns = useCampaignStore()
    const a = campaigns.create({ name: 'A' })
    const b = campaigns.create({ name: 'B' })
    const sessions = useSessionStore()
    sessions.create({ campaignId: a.id, title: 'older', playedAt: '2026-01-01T20:00:00Z' })
    campaigns.recordSession(a.id, '2026-01-01T20:00:00Z')
    sessions.create({ campaignId: b.id, title: 'newer', playedAt: '2026-03-01T20:00:00Z' })
    campaigns.recordSession(b.id, '2026-03-01T20:00:00Z')

    const d = useDashboardData()
    expect(d.mostRecentCampaign.value?.name).toBe('B')
  })

  it('summaries report per campaign counts', () => {
    const campaigns = useCampaignStore()
    const c = campaigns.create({ name: 'X' })
    useCharacterStore().create({ campaignId: c.id, name: 'A' })
    useCharacterStore().create({ campaignId: c.id, name: 'B' })

    const d = useDashboardData()
    expect(d.summaries.value).toHaveLength(1)
    expect(d.summaries.value[0]?.cast).toBe(2)
  })
})
