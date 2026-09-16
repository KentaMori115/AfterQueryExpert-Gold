import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import { generateId } from '@core/ids'
import { getStore } from '@core/persistence/storage'
import {
  type RuleScope,
  type RuleSnippet,
  type RuleSnippetDraft,
  compareForListing,
  ruleSnippetDraftSchema,
} from '@core/models/rule-snippet'
import { now } from '@core/time/timestamps'

const STORAGE_KEY = 'rules:snippets:v1'

interface SerialState {
  byId: Record<string, RuleSnippet>
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

export class RuleSnippetValidationError extends Error {
  constructor(public issues: Record<string, string>) {
    super(Object.entries(issues).map(([k, v]) => `${k}: ${v}`).join('; '))
    this.name = 'RuleSnippetValidationError'
  }
}

export const useRuleSnippetStore = defineStore('ruleSnippets', () => {
  const state = ref<SerialState>(load())

  const all = computed<RuleSnippet[]>(() =>
    Object.values(state.value.byId).sort(compareForListing),
  )

  function forScope(scope: RuleScope): RuleSnippet[] {
    return all.value.filter((s) => s.scope === scope)
  }

  function byId(id: string): RuleSnippet | null {
    return state.value.byId[id] ?? null
  }

  function create(draft: RuleSnippetDraft): RuleSnippet {
    const parsed = ruleSnippetDraftSchema.safeParse(draft)
    if (!parsed.success) {
      const issues: Record<string, string> = {}
      for (const i of parsed.error.issues) issues[i.path.join('.') || '_'] = i.message
      throw new RuleSnippetValidationError(issues)
    }
    const ts = now()
    const snippet: RuleSnippet = {
      id: generateId('rs'),
      title: parsed.data.title.trim(),
      scope: parsed.data.scope,
      body: parsed.data.body.trim(),
      source: (parsed.data.source ?? '').trim(),
      pinned: parsed.data.pinned ?? false,
      createdAt: ts,
      updatedAt: ts,
    }
    const next = clone(state.value)
    next.byId[snippet.id] = snippet
    state.value = next
    persist(state.value)
    return snippet
  }

  function update(id: string, draft: RuleSnippetDraft): RuleSnippet {
    const existing = byId(id)
    if (!existing) throw new Error(`snippet ${id} not found`)
    const parsed = ruleSnippetDraftSchema.safeParse(draft)
    if (!parsed.success) {
      const issues: Record<string, string> = {}
      for (const i of parsed.error.issues) issues[i.path.join('.') || '_'] = i.message
      throw new RuleSnippetValidationError(issues)
    }
    const next = clone(state.value)
    next.byId[id] = {
      ...existing,
      title: parsed.data.title.trim(),
      scope: parsed.data.scope,
      body: parsed.data.body.trim(),
      source: (parsed.data.source ?? existing.source).trim(),
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
    forScope,
    byId,
    create,
    update,
    togglePin,
    remove,
    $reset,
  }
})
