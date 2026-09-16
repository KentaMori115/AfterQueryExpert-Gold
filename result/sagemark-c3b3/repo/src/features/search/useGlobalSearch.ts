import { computed, ref } from 'vue'

import type { CampaignId } from '@core/ids'
import { useCampaignStore } from '@features/campaigns/store'
import { useCharacterStore } from '@features/characters/store'
import { useFactionStore } from '@features/factions/store'
import { useLocationStore } from '@features/locations/store'
import { useLoreStore } from '@features/lore/store'
import { useQuestStore } from '@features/quests/store'
import { useSessionStore } from '@features/sessions/store'
import { useItemStore } from '@features/items/store'

export type SearchResultKind =
  | 'character'
  | 'faction'
  | 'location'
  | 'lore'
  | 'item'
  | 'quest'
  | 'session'

export interface SearchResult {
  kind: SearchResultKind
  id: string
  label: string
  hint: string
  routeTo: string
}

export function useGlobalSearch(campaignId: () => CampaignId | null) {
  const characters = useCharacterStore()
  const factions = useFactionStore()
  const locations = useLocationStore()
  const lore = useLoreStore()
  const items = useItemStore()
  const quests = useQuestStore()
  const sessions = useSessionStore()
  // include campaigns to keep them in scope; satisfies the linter
  void useCampaignStore

  const query = ref('')

  function lowerIncludes(haystack: string, needle: string): boolean {
    return haystack.toLowerCase().includes(needle)
  }

  const results = computed<SearchResult[]>(() => {
    const cid = campaignId()
    if (!cid) return []
    const q = query.value.trim().toLowerCase()
    if (!q) return []
    const out: SearchResult[] = []
    for (const ch of characters.forCampaign(cid)) {
      if (lowerIncludes(ch.name, q) || lowerIncludes(ch.blurb, q) || lowerIncludes(ch.vocation, q)) {
        out.push({
          kind: 'character',
          id: ch.id,
          label: ch.name,
          hint: ch.vocation || ch.ancestry || 'character',
          routeTo: `/campaigns/${cid}/characters/${ch.id}`,
        })
      }
    }
    for (const f of factions.forCampaign(cid)) {
      if (lowerIncludes(f.name, q) || lowerIncludes(f.motto, q) || lowerIncludes(f.description, q)) {
        out.push({
          kind: 'faction',
          id: f.id,
          label: f.name,
          hint: f.motto || 'faction',
          routeTo: `/campaigns/${cid}/factions/${f.id}`,
        })
      }
    }
    for (const l of locations.forCampaign(cid)) {
      if (lowerIncludes(l.name, q) || lowerIncludes(l.shortDescription, q) || lowerIncludes(l.notes, q)) {
        out.push({
          kind: 'location',
          id: l.id,
          label: l.name,
          hint: l.shortDescription || 'place',
          routeTo: `/campaigns/${cid}/locations/${l.id}`,
        })
      }
    }
    for (const e of lore.forCampaign(cid)) {
      if (lowerIncludes(e.title, q) || lowerIncludes(e.body, q) || e.tags.some((t) => lowerIncludes(t, q))) {
        out.push({
          kind: 'lore',
          id: e.id,
          label: e.title,
          hint: e.tags.join(', ') || 'lore',
          routeTo: `/campaigns/${cid}/lore`,
        })
      }
    }
    for (const it of items.forCampaign(cid)) {
      if (lowerIncludes(it.name, q) || lowerIncludes(it.description, q)) {
        out.push({
          kind: 'item',
          id: it.id,
          label: it.name,
          hint: it.rarity,
          routeTo: `/campaigns/${cid}/items`,
        })
      }
    }
    for (const qst of quests.forCampaign(cid)) {
      if (lowerIncludes(qst.title, q) || lowerIncludes(qst.description, q)) {
        out.push({
          kind: 'quest',
          id: qst.id,
          label: qst.title,
          hint: qst.status,
          routeTo: `/campaigns/${cid}/quests`,
        })
      }
    }
    for (const s of sessions.forCampaign(cid)) {
      if (lowerIncludes(s.title, q) || lowerIncludes(s.summary, q) || lowerIncludes(s.log, q)) {
        out.push({
          kind: 'session',
          id: s.id,
          label: s.title || `Session ${s.number}`,
          hint: 'session log',
          routeTo: `/campaigns/${cid}/sessions/${s.id}`,
        })
      }
    }
    return out
  })

  const grouped = computed<Record<SearchResultKind, SearchResult[]>>(() => {
    const empty: Record<SearchResultKind, SearchResult[]> = {
      character: [],
      faction: [],
      location: [],
      lore: [],
      item: [],
      quest: [],
      session: [],
    }
    for (const r of results.value) empty[r.kind].push(r)
    return empty
  })

  return { query, results, grouped }
}
