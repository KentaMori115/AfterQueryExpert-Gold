import { computed, type ComputedRef } from 'vue'

import type { CampaignId } from '@core/ids'
import { isOpen } from '@core/models/campaign'

import { useCampaignStore } from '@features/campaigns/store'
import { useCharacterStore } from '@features/characters/store'
import { useFactionStore } from '@features/factions/store'
import { useSessionStore } from '@features/sessions/store'
import { useArcStore } from '@features/arcs/store'
import { useQuestStore } from '@features/quests/store'
import { useNoteStore } from '@features/notes/store'

export interface CampaignSummary {
  id: CampaignId
  name: string
  sessionCount: number
  liveArcs: number
  cast: number
  factions: number
  openQuests: number
  overdueNotes: number
  lastPlayedAt: string | null
  status: string
}

export interface DashboardData {
  totalCampaigns: ComputedRef<number>
  openCampaigns: ComputedRef<number>
  totalSessions: ComputedRef<number>
  totalCharacters: ComputedRef<number>
  totalFactions: ComputedRef<number>
  totalQuests: ComputedRef<number>
  totalArcs: ComputedRef<number>
  summaries: ComputedRef<CampaignSummary[]>
  mostRecentCampaign: ComputedRef<CampaignSummary | null>
}

export function useDashboardData(): DashboardData {
  const campaigns = useCampaignStore()
  const characters = useCharacterStore()
  const factions = useFactionStore()
  const sessions = useSessionStore()
  const arcs = useArcStore()
  const quests = useQuestStore()
  const notes = useNoteStore()

  const summaries = computed<CampaignSummary[]>(() => {
    const now = new Date()
    return campaigns.sorted.map((c) => ({
      id: c.id,
      name: c.name,
      sessionCount: sessions.forCampaign(c.id).length,
      liveArcs: arcs.liveCountFor(c.id),
      cast: characters.forCampaign(c.id).length,
      factions: factions.forCampaign(c.id).length,
      openQuests: quests.openFor(c.id).length,
      overdueNotes: notes.overdueFor(c.id, now).length,
      lastPlayedAt: c.lastPlayedAt,
      status: c.status,
    }))
  })

  const totalCampaigns = computed(() => campaigns.all.length)
  const openCampaigns = computed(() => campaigns.all.filter(isOpen).length)
  const totalSessions = computed(() => summaries.value.reduce((s, c) => s + c.sessionCount, 0))
  const totalCharacters = computed(() => summaries.value.reduce((s, c) => s + c.cast, 0))
  const totalFactions = computed(() => summaries.value.reduce((s, c) => s + c.factions, 0))
  const totalQuests = computed(() => summaries.value.reduce((s, c) => s + c.openQuests, 0))
  const totalArcs = computed(() => summaries.value.reduce((s, c) => s + c.liveArcs, 0))

  const mostRecentCampaign = computed<CampaignSummary | null>(() => {
    let best: CampaignSummary | null = null
    let bestTs = -1
    for (const s of summaries.value) {
      if (!s.lastPlayedAt) continue
      const ts = Date.parse(s.lastPlayedAt)
      if (ts > bestTs) {
        best = s
        bestTs = ts
      }
    }
    return best ?? summaries.value[0] ?? null
  })

  return {
    totalCampaigns,
    openCampaigns,
    totalSessions,
    totalCharacters,
    totalFactions,
    totalQuests,
    totalArcs,
    summaries,
    mostRecentCampaign,
  }
}
