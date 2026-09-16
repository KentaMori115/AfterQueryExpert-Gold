import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import type { CampaignId, SessionId } from '@core/ids'
import { generateId } from '@core/ids'
import { getStore } from '@core/persistence/storage'
import { asTimestamp, now, type ISOTimestamp } from '@core/time/timestamps'

const STORAGE_KEY = 'prep:checklists:v1'

export type PrepItemKind =
  | 'scene'
  | 'npc'
  | 'handout'
  | 'reminder'
  | 'rules'
  | 'logistics'

export const PREP_ITEM_KINDS: ReadonlyArray<PrepItemKind> = [
  'scene',
  'npc',
  'handout',
  'reminder',
  'rules',
  'logistics',
]

export const PREP_KIND_LABELS: Record<PrepItemKind, string> = {
  scene: 'Scene',
  npc: 'NPC',
  handout: 'Handout',
  reminder: 'Reminder',
  rules: 'Rules check',
  logistics: 'Logistics',
}

export interface PrepItem {
  id: string
  kind: PrepItemKind
  text: string
  done: boolean
  createdAt: ISOTimestamp
  completedAt: ISOTimestamp | null
}

export interface PrepChecklist {
  campaignId: CampaignId
  sessionId: SessionId | null
  items: PrepItem[]
  createdAt: ISOTimestamp
  updatedAt: ISOTimestamp
}

interface SerialState {
  byKey: Record<string, PrepChecklist>
}

function keyFor(campaignId: CampaignId, sessionId: SessionId | null): string {
  return `${campaignId}:${sessionId ?? 'next'}`
}

function load(): SerialState {
  const raw = getStore().get(STORAGE_KEY)
  if (!raw) return { byKey: {} }
  try {
    const parsed = JSON.parse(raw) as SerialState
    if (parsed && typeof parsed === 'object' && parsed.byKey) return parsed
  } catch {
    return { byKey: {} }
  }
  return { byKey: {} }
}

function persist(state: SerialState): void {
  getStore().set(STORAGE_KEY, JSON.stringify(state))
}

function emptyChecklist(campaignId: CampaignId, sessionId: SessionId | null): PrepChecklist {
  const ts = now()
  return {
    campaignId,
    sessionId,
    items: [],
    createdAt: ts,
    updatedAt: ts,
  }
}

export const DEFAULT_PREP_TEMPLATE: ReadonlyArray<{ kind: PrepItemKind; text: string }> = Object.freeze([
  { kind: 'scene', text: 'Strong opening scene with a question' },
  { kind: 'scene', text: 'One alternative scene if the party turns away' },
  { kind: 'npc', text: 'Three NPC voices ready' },
  { kind: 'handout', text: 'Print handouts or queue them digitally' },
  { kind: 'rules', text: 'One ruling to look up before play' },
  { kind: 'reminder', text: 'Reread the last session log' },
  { kind: 'logistics', text: 'Snacks and water on the table' },
])

export const usePrepStore = defineStore('prep', () => {
  const state = ref<SerialState>(load())

  function checklist(campaignId: CampaignId, sessionId: SessionId | null): PrepChecklist {
    const key = keyFor(campaignId, sessionId)
    const existing = state.value.byKey[key]
    if (existing) return existing
    const fresh = emptyChecklist(campaignId, sessionId)
    state.value.byKey[key] = fresh
    persist(state.value)
    return fresh
  }

  function tryGet(campaignId: CampaignId, sessionId: SessionId | null): PrepChecklist | null {
    return state.value.byKey[keyFor(campaignId, sessionId)] ?? null
  }

  function update(checklist: PrepChecklist): void {
    state.value.byKey[keyFor(checklist.campaignId, checklist.sessionId)] = {
      ...checklist,
      updatedAt: now(),
    }
    state.value = { byKey: { ...state.value.byKey } }
    persist(state.value)
  }

  function addItem(
    campaignId: CampaignId,
    sessionId: SessionId | null,
    kind: PrepItemKind,
    text: string,
  ): PrepItem {
    const list = checklist(campaignId, sessionId)
    const item: PrepItem = {
      id: generateId('prep'),
      kind,
      text: text.trim(),
      done: false,
      createdAt: now(),
      completedAt: null,
    }
    update({ ...list, items: [...list.items, item] })
    return item
  }

  function toggleItem(campaignId: CampaignId, sessionId: SessionId | null, itemId: string): void {
    const list = checklist(campaignId, sessionId)
    const items = list.items.map((it) => {
      if (it.id !== itemId) return it
      const done = !it.done
      return { ...it, done, completedAt: done ? asTimestamp(new Date()) : null }
    })
    update({ ...list, items })
  }

  function removeItem(campaignId: CampaignId, sessionId: SessionId | null, itemId: string): void {
    const list = checklist(campaignId, sessionId)
    update({ ...list, items: list.items.filter((it) => it.id !== itemId) })
  }

  function applyTemplate(campaignId: CampaignId, sessionId: SessionId | null): void {
    const list = checklist(campaignId, sessionId)
    const items: PrepItem[] = [
      ...list.items,
      ...DEFAULT_PREP_TEMPLATE.map((seed) => ({
        id: generateId('prep'),
        kind: seed.kind,
        text: seed.text,
        done: false,
        createdAt: now(),
        completedAt: null,
      })),
    ]
    update({ ...list, items })
  }

  function clearList(campaignId: CampaignId, sessionId: SessionId | null): void {
    const list = checklist(campaignId, sessionId)
    update({ ...list, items: [] })
  }

  function progress(campaignId: CampaignId, sessionId: SessionId | null): {
    total: number
    done: number
    pct: number
  } {
    const list = tryGet(campaignId, sessionId)
    if (!list || list.items.length === 0) return { total: 0, done: 0, pct: 0 }
    const done = list.items.filter((it) => it.done).length
    return { total: list.items.length, done, pct: Math.round((done / list.items.length) * 100) }
  }

  const total = computed(() => Object.keys(state.value.byKey).length)

  function $reset(): void {
    state.value = { byKey: {} }
    persist(state.value)
  }

  return {
    checklist,
    tryGet,
    addItem,
    toggleItem,
    removeItem,
    applyTemplate,
    clearList,
    progress,
    total,
    $reset,
  }
})
