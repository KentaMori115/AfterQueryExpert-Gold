import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import type { CampaignId } from '@core/ids'
import { generateId } from '@core/ids'
import { getStore } from '@core/persistence/storage'
import {
  type JournalEntry,
  type JournalEntryDraft,
  compareForListing,
  journalEntryDraftSchema,
  moodStreak,
} from '@core/models/journal'
import { now } from '@core/time/timestamps'

const STORAGE_KEY = 'gm-journal:v1'

interface SerialState {
  byId: Record<string, JournalEntry>
}

function load(): SerialState {
  const raw = getStore().get(STORAGE_KEY)
  if (!raw) return { byId: {} }
  try {
    const parsed = JSON.parse(raw) as SerialState
    if (parsed && parsed.byId) return parsed
  } catch {
    return { byId: {} }
  }
  return { byId: {} }
}

function persist(state: SerialState): void {
  getStore().set(STORAGE_KEY, JSON.stringify(state))
}

function clone(state: SerialState): SerialState {
  return { byId: { ...state.byId } }
}

export class JournalValidationError extends Error {
  constructor(public issues: Record<string, string>) {
    super(Object.entries(issues).map(([k, v]) => `${k}: ${v}`).join('; '))
    this.name = 'JournalValidationError'
  }
}

export const useJournalStore = defineStore('gm-journal', () => {
  const state = ref<SerialState>(load())

  const all = computed<JournalEntry[]>(() =>
    Object.values(state.value.byId).sort(compareForListing),
  )

  function forCampaign(campaignId: CampaignId | null): JournalEntry[] {
    return all.value.filter((e) => e.campaignId === campaignId)
  }

  function byId(id: string): JournalEntry | null {
    return state.value.byId[id] ?? null
  }

  function streakFor(campaignId: CampaignId | null) {
    return moodStreak(forCampaign(campaignId))
  }

  function create(draft: JournalEntryDraft): JournalEntry {
    const parsed = journalEntryDraftSchema.safeParse(draft)
    if (!parsed.success) {
      const issues: Record<string, string> = {}
      for (const i of parsed.error.issues) issues[i.path.join('.') || '_'] = i.message
      throw new JournalValidationError(issues)
    }
    const ts = now()
    const entry: JournalEntry = {
      id: generateId('j'),
      campaignId: (parsed.data.campaignId ?? null) as string | null,
      title: parsed.data.title.trim(),
      body: parsed.data.body.trim(),
      mood: parsed.data.mood ?? 'steady',
      pinned: parsed.data.pinned ?? false,
      createdAt: ts,
      updatedAt: ts,
    }
    const next = clone(state.value)
    next.byId[entry.id] = entry
    state.value = next
    persist(state.value)
    return entry
  }

  function update(id: string, draft: JournalEntryDraft): JournalEntry {
    const existing = byId(id)
    if (!existing) throw new Error(`entry ${id} not found`)
    const parsed = journalEntryDraftSchema.safeParse(draft)
    if (!parsed.success) {
      const issues: Record<string, string> = {}
      for (const i of parsed.error.issues) issues[i.path.join('.') || '_'] = i.message
      throw new JournalValidationError(issues)
    }
    const next = clone(state.value)
    next.byId[id] = {
      ...existing,
      campaignId: (parsed.data.campaignId ?? existing.campaignId) as string | null,
      title: parsed.data.title.trim(),
      body: parsed.data.body.trim(),
      mood: parsed.data.mood ?? existing.mood,
      pinned: parsed.data.pinned ?? existing.pinned,
      updatedAt: now(),
    }
    state.value = next
    persist(state.value)
    return next.byId[id]!
  }

  function togglePin(id: string): void {
    const existing = byId(id)
    if (!existing) return
    const next = clone(state.value)
    next.byId[id] = { ...existing, pinned: !existing.pinned, updatedAt: now() }
    state.value = next
    persist(state.value)
  }

  function remove(id: string): void {
    if (!(id in state.value.byId)) return
    const next = clone(state.value)
    delete next.byId[id]
    state.value = next
    persist(state.value)
  }

  function $reset(): void {
    state.value = { byId: {} }
    persist(state.value)
  }

  return {
    all,
    forCampaign,
    byId,
    streakFor,
    create,
    update,
    togglePin,
    remove,
    $reset,
  }
})
