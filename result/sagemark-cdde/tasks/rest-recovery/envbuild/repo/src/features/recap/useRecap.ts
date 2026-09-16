import { computed, type ComputedRef } from 'vue'

import type { CampaignId, CharacterId } from '@core/ids'
import { extractMentions } from '@core/lib/mentions'
import { formatInWorldDate } from '@core/models/timeline'
import { sessionLabel } from '@core/models/session'

import { useCampaignStore } from '@features/campaigns/store'
import { useCharacterStore } from '@features/characters/store'
import { useFactionStore } from '@features/factions/store'
import { useLocationStore } from '@features/locations/store'
import { useQuestStore } from '@features/quests/store'
import { useSessionStore } from '@features/sessions/store'
import { useTimelineStore } from '@features/timeline/store'

export interface RecapBullet {
  kind: 'session' | 'quest' | 'event' | 'mention'
  text: string
}

export interface RecapSection {
  title: string
  bullets: RecapBullet[]
}

export interface RecapResult {
  campaignName: string
  sections: RecapSection[]
  flat: RecapBullet[]
}

export interface UseRecapOptions {
  campaignId: () => CampaignId | null
  lookback?: () => number
}

const DEFAULT_LOOKBACK = 3

export function useRecap(opts: UseRecapOptions): { recap: ComputedRef<RecapResult | null> } {
  const campaigns = useCampaignStore()
  const sessions = useSessionStore()
  const quests = useQuestStore()
  const characters = useCharacterStore()
  const factions = useFactionStore()
  const locations = useLocationStore()
  const timeline = useTimelineStore()

  const recap = computed<RecapResult | null>(() => {
    const cid = opts.campaignId()
    if (!cid) return null
    const campaign = campaigns.all.find((c) => c.id === cid)
    if (!campaign) return null
    const lookback = Math.max(1, opts.lookback?.() ?? DEFAULT_LOOKBACK)

    const recentSessions = [...sessions.chronologicalFor(cid)]
      .reverse()
      .slice(0, lookback)

    const sessionBullets: RecapBullet[] = recentSessions.map((s) => ({
      kind: 'session',
      text: `${sessionLabel(s)} - ${s.summary || s.log.slice(0, 120) || 'no summary recorded'}`,
    }))

    const openQuests = quests
      .forCampaign(cid)
      .filter((q) => q.status === 'accepted' || q.status === 'in-progress' || q.status === 'available')
      .slice(0, 6)
    const questBullets: RecapBullet[] = openQuests.map((q) => ({
      kind: 'quest',
      text: `${q.title} (${q.status})`,
    }))

    const eventBullets: RecapBullet[] = [...timeline.chronologicalFor(cid)]
      .filter((e) => e.revealed)
      .reverse()
      .slice(0, 5)
      .map((e) => ({
        kind: 'event',
        text: `${formatInWorldDate(e.date)} - ${e.title}`,
      }))

    const mentionCounts = new Map<string, number>()
    for (const s of recentSessions) {
      const haystack = `${s.title}\n${s.summary}\n${s.log}`
      for (const m of extractMentions(haystack)) {
        const key = m.trim().toLowerCase()
        if (key.length === 0) continue
        mentionCounts.set(key, (mentionCounts.get(key) ?? 0) + 1)
      }
    }
    const mentionEntities = collectKnown(characters, factions, locations, cid)
    const mentionBullets: RecapBullet[] = []
    for (const [lower, count] of mentionCounts.entries()) {
      const known = mentionEntities.get(lower)
      if (known) {
        mentionBullets.push({
          kind: 'mention',
          text: `${known.label} (${known.kind}) mentioned ${count} time${count === 1 ? '' : 's'}`,
        })
      }
    }
    mentionBullets.sort((a, b) => a.text.localeCompare(b.text))

    const sections: RecapSection[] = []
    if (sessionBullets.length > 0) {
      sections.push({ title: 'Last sessions', bullets: sessionBullets })
    }
    if (questBullets.length > 0) {
      sections.push({ title: 'Open quests', bullets: questBullets })
    }
    if (eventBullets.length > 0) {
      sections.push({ title: 'Revealed timeline', bullets: eventBullets })
    }
    if (mentionBullets.length > 0) {
      sections.push({ title: 'Names that came up', bullets: mentionBullets.slice(0, 8) })
    }

    return {
      campaignName: campaign.name,
      sections,
      flat: sections.flatMap((s) => s.bullets),
    }
  })

  return { recap }
}

function collectKnown(
  characters: ReturnType<typeof useCharacterStore>,
  factions: ReturnType<typeof useFactionStore>,
  locations: ReturnType<typeof useLocationStore>,
  cid: CampaignId,
): Map<string, { label: string; kind: string }> {
  const out = new Map<string, { label: string; kind: string }>()
  for (const c of characters.forCampaign(cid)) {
    out.set(c.name.toLowerCase(), { label: c.name, kind: 'character' })
  }
  for (const f of factions.forCampaign(cid)) {
    out.set(f.name.toLowerCase(), { label: f.name, kind: 'faction' })
  }
  for (const l of locations.forCampaign(cid)) {
    out.set(l.name.toLowerCase(), { label: l.name, kind: 'place' })
  }
  return out
}

export function recapAsMarkdown(recap: RecapResult): string {
  const lines: string[] = []
  lines.push(`# Where we left off in ${recap.campaignName}`)
  for (const section of recap.sections) {
    lines.push('')
    lines.push(`## ${section.title}`)
    for (const b of section.bullets) lines.push(`- ${b.text}`)
  }
  return lines.join('\n')
}

// Mention dropping a character by id from a campaign-wide pass is uncommon,
// but the helper below is here so the test file can target the same surface.
export function _characterMentions(
  haystack: string,
  characters: ReturnType<typeof useCharacterStore>,
  cid: CampaignId,
): Array<{ id: CharacterId; count: number }> {
  const counts = new Map<CharacterId, number>()
  for (const c of characters.forCampaign(cid)) {
    const lower = c.name.toLowerCase()
    const matches = haystack.toLowerCase().split(lower).length - 1
    if (matches > 0) counts.set(c.id, matches)
  }
  return Array.from(counts.entries()).map(([id, count]) => ({ id, count }))
}
