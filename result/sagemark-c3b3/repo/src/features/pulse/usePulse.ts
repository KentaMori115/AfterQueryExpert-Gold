import { computed, type ComputedRef } from 'vue'

import type { CampaignId } from '@core/ids'
import { compareTimestamp } from '@core/time/timestamps'

import { useArcStore } from '@features/arcs/store'
import { useCampaignStore } from '@features/campaigns/store'
import { useEncounterStore } from '@features/encounters/store'
import { useNoteStore } from '@features/notes/store'
import { useQuestStore } from '@features/quests/store'
import { useSessionStore } from '@features/sessions/store'

export type PulseBeatKind = 'overdue-note' | 'open-quest' | 'live-arc' | 'unresolved-encounter' | 'fresh-session'

export interface PulseBeat {
  kind: PulseBeatKind
  title: string
  detail: string
  weight: number
}

export interface PulseSummary {
  campaignName: string
  beats: PulseBeat[]
  freshness: 'fresh' | 'stalling' | 'cold'
  daysSinceLastSession: number | null
}

export interface UsePulseOptions {
  campaignId: () => CampaignId | null
}

export function usePulse(opts: UsePulseOptions): { pulse: ComputedRef<PulseSummary | null> } {
  const campaigns = useCampaignStore()
  const sessions = useSessionStore()
  const quests = useQuestStore()
  const notes = useNoteStore()
  const arcs = useArcStore()
  const encounters = useEncounterStore()

  const pulse = computed<PulseSummary | null>(() => {
    const cid = opts.campaignId()
    if (!cid) return null
    const campaign = campaigns.all.find((c) => c.id === cid)
    if (!campaign) return null

    const beats: PulseBeat[] = []

    for (const note of notes.overdueFor(cid)) {
      beats.push({
        kind: 'overdue-note',
        title: note.title || 'Untitled note',
        detail: `priority ${note.priority}`,
        weight: 4,
      })
    }

    for (const quest of quests.openFor(cid).slice(0, 5)) {
      beats.push({
        kind: 'open-quest',
        title: quest.title,
        detail: quest.status,
        weight: 2,
      })
    }

    const liveArcs = arcs
      .forCampaign(cid)
      .filter((a) => a.status === 'active' || a.status === 'climbing')
      .slice(0, 3)
    for (const arc of liveArcs) {
      beats.push({
        kind: 'live-arc',
        title: arc.title,
        detail: arc.status,
        weight: 3,
      })
    }

    const unresolved = encounters.forCampaign(cid).filter((e) => !e.resolved).slice(0, 3)
    for (const enc of unresolved) {
      beats.push({
        kind: 'unresolved-encounter',
        title: enc.title,
        detail: enc.kind,
        weight: 1,
      })
    }

    const allSessions = sessions.chronologicalFor(cid)
    const last = allSessions.length > 0 ? allSessions[allSessions.length - 1]! : null
    const daysSinceLastSession = last ? daysBetween(last.playedAt, new Date()) : null
    if (last && daysSinceLastSession !== null && daysSinceLastSession <= 7) {
      beats.push({
        kind: 'fresh-session',
        title: last.title || `Session ${last.number}`,
        detail: `${daysSinceLastSession} days ago`,
        weight: 1,
      })
    }

    beats.sort((a, b) => b.weight - a.weight)

    let freshness: 'fresh' | 'stalling' | 'cold' = 'cold'
    if (daysSinceLastSession === null) freshness = 'cold'
    else if (daysSinceLastSession <= 14) freshness = 'fresh'
    else if (daysSinceLastSession <= 45) freshness = 'stalling'

    return {
      campaignName: campaign.name,
      beats,
      freshness,
      daysSinceLastSession,
    }
  })

  return { pulse }
}

function daysBetween(iso: string, now: Date): number {
  const then = Date.parse(iso)
  if (Number.isNaN(then)) return Number.POSITIVE_INFINITY
  const diff = now.getTime() - then
  return Math.floor(diff / (1000 * 60 * 60 * 24))
}

void compareTimestamp
