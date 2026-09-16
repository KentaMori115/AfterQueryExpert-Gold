import { computed, type ComputedRef } from 'vue'

import type { CampaignId } from '@core/ids'
import { extractMentions } from '@core/lib/mentions'
import { useNoteStore } from '@features/notes/store'
import { useLoreStore } from '@features/lore/store'
import { useSessionStore } from '@features/sessions/store'

export interface BacklinkHit {
  kind: 'note' | 'lore' | 'session'
  id: string
  label: string
  routeTo: string
  preview: string
}

export interface UseBacklinksOptions {
  campaignId: () => CampaignId | null
  targetName: () => string
}

export function useBacklinks(opts: UseBacklinksOptions): { hits: ComputedRef<BacklinkHit[]> } {
  const notes = useNoteStore()
  const lore = useLoreStore()
  const sessions = useSessionStore()

  const hits = computed<BacklinkHit[]>(() => {
    const cid = opts.campaignId()
    const name = opts.targetName().trim().toLowerCase()
    if (!cid || !name) return []
    const out: BacklinkHit[] = []

    for (const note of notes.forCampaign(cid)) {
      if (mentionsName(note.body, name) || mentionsName(note.title, name)) {
        out.push({
          kind: 'note',
          id: note.id,
          label: note.title || note.body.slice(0, 60),
          routeTo: `/campaigns/${cid}/notes`,
          preview: truncate(note.body, 140),
        })
      }
    }

    for (const entry of lore.forCampaign(cid)) {
      if (mentionsName(entry.body, name) || mentionsName(entry.title, name)) {
        out.push({
          kind: 'lore',
          id: entry.id,
          label: entry.title,
          routeTo: `/campaigns/${cid}/lore`,
          preview: truncate(entry.body, 140),
        })
      }
    }

    for (const session of sessions.forCampaign(cid)) {
      if (
        mentionsName(session.summary, name) ||
        mentionsName(session.log, name) ||
        mentionsName(session.title, name)
      ) {
        out.push({
          kind: 'session',
          id: session.id,
          label: session.title || `Session ${session.number}`,
          routeTo: `/campaigns/${cid}/sessions/${session.id}`,
          preview: truncate(session.summary || session.log, 140),
        })
      }
    }

    return out
  })

  return { hits }
}

function mentionsName(text: string, name: string): boolean {
  if (!text) return false
  const mentions = extractMentions(text)
  for (const m of mentions) {
    if (m.toLowerCase() === name) return true
  }
  const lower = text.toLowerCase()
  return lower.includes(`[[${name}]]`)
}

function truncate(text: string, len: number): string {
  if (!text) return ''
  if (text.length <= len) return text
  return text.slice(0, len - 1) + '…'
}
