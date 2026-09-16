import { computed, type ComputedRef } from 'vue'

import type { CampaignId } from '@core/ids'
import { format, parseISO } from 'date-fns'

import { useCharacterStore } from '@features/characters/store'
import { useFactionStore } from '@features/factions/store'
import { useLoreStore } from '@features/lore/store'
import { useQuestStore } from '@features/quests/store'
import { useSessionStore } from '@features/sessions/store'
import { useArcStore } from '@features/arcs/store'
import { useItemStore } from '@features/items/store'

export interface SessionsByMonth {
  key: string // YYYY-MM
  label: string
  count: number
}

export interface FactionInfluencePoint {
  name: string
  influence: number
  active: boolean
}

export interface PartyComposition {
  pcs: number
  npcsAlive: number
  npcsFallen: number
}

export function useCampaignReports(campaignId: () => CampaignId | null): {
  sessionsByMonth: ComputedRef<SessionsByMonth[]>
  factionInfluence: ComputedRef<FactionInfluencePoint[]>
  partyComposition: ComputedRef<PartyComposition>
  openQuestCount: ComputedRef<number>
  unrevealedLoreCount: ComputedRef<number>
  totalLootGp: ComputedRef<number>
  liveArcCount: ComputedRef<number>
} {
  const characters = useCharacterStore()
  const factions = useFactionStore()
  const lore = useLoreStore()
  const quests = useQuestStore()
  const sessions = useSessionStore()
  const arcs = useArcStore()
  const items = useItemStore()

  const sessionsByMonth = computed<SessionsByMonth[]>(() => {
    const cid = campaignId()
    if (!cid) return []
    const buckets = new Map<string, number>()
    for (const s of sessions.forCampaign(cid)) {
      const d = parseISO(s.playedAt)
      const key = format(d, 'yyyy-MM')
      buckets.set(key, (buckets.get(key) ?? 0) + 1)
    }
    return [...buckets.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, count]) => ({
        key,
        label: format(parseISO(`${key}-01T00:00:00Z`), 'MMM yyyy'),
        count,
      }))
  })

  const factionInfluence = computed<FactionInfluencePoint[]>(() => {
    const cid = campaignId()
    if (!cid) return []
    return [...factions.forCampaign(cid)]
      .sort((a, b) => b.influence - a.influence)
      .map((f) => ({ name: f.name, influence: f.influence, active: f.active }))
  })

  const partyComposition = computed<PartyComposition>(() => {
    const cid = campaignId()
    if (!cid) return { pcs: 0, npcsAlive: 0, npcsFallen: 0 }
    const cast = characters.forCampaign(cid)
    return {
      pcs: cast.filter((c) => c.kind === 'pc').length,
      npcsAlive: cast.filter((c) => c.kind === 'npc' && c.alive).length,
      npcsFallen: cast.filter((c) => c.kind === 'npc' && !c.alive).length,
    }
  })

  const openQuestCount = computed(() => {
    const cid = campaignId()
    if (!cid) return 0
    return quests.openFor(cid).length
  })

  const unrevealedLoreCount = computed(() => {
    const cid = campaignId()
    if (!cid) return 0
    return lore.forCampaign(cid).filter((e) => !e.revealed).length
  })

  const totalLootGp = computed(() => {
    const cid = campaignId()
    if (!cid) return 0
    return items.totalValueFor(cid)
  })

  const liveArcCount = computed(() => {
    const cid = campaignId()
    if (!cid) return 0
    return arcs.liveCountFor(cid)
  })

  return {
    sessionsByMonth,
    factionInfluence,
    partyComposition,
    openQuestCount,
    unrevealedLoreCount,
    totalLootGp,
    liveArcCount,
  }
}
