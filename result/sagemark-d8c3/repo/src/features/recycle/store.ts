import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import { generateId } from '@core/ids'
import { asTimestamp, now, toDate } from '@core/time/timestamps'

const STORAGE_KEY = 'sagemark:recycle:v1'

export type RecycleEntityKind =
  | 'character'
  | 'faction'
  | 'location'
  | 'session'
  | 'arc'
  | 'encounter'
  | 'lore'
  | 'item'
  | 'quest'
  | 'note'

export interface RecycledEntry {
  id: string
  kind: RecycleEntityKind
  payload: unknown
  deletedAt: string
  expiresAt: string
}

const DEFAULT_TTL_DAYS = 30

function loadAll(): RecycledEntry[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as RecycledEntry[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function persist(entries: ReadonlyArray<RecycledEntry>): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries))
  } catch {
    // best effort
  }
}

export const useRecycleStore = defineStore('recycle', () => {
  const entries = ref<RecycledEntry[]>(loadAll())
  const ttlDays = ref<number>(DEFAULT_TTL_DAYS)

  function rememberDelete(kind: RecycleEntityKind, payload: unknown): RecycledEntry {
    const created = now()
    const expires = new Date(toDate(created).getTime() + ttlDays.value * 24 * 60 * 60 * 1000)
    const entry: RecycledEntry = {
      id: generateId('rec'),
      kind,
      payload,
      deletedAt: created,
      expiresAt: asTimestamp(expires),
    }
    entries.value = [entry, ...entries.value]
    persist(entries.value)
    return entry
  }

  function purge(id: string): void {
    entries.value = entries.value.filter((e) => e.id !== id)
    persist(entries.value)
  }

  function purgeExpired(asOf: Date = new Date()): number {
    const cutoff = asOf.getTime()
    const before = entries.value.length
    entries.value = entries.value.filter((e) => Date.parse(e.expiresAt) >= cutoff)
    if (entries.value.length !== before) persist(entries.value)
    return before - entries.value.length
  }

  function purgeAll(): number {
    const removed = entries.value.length
    entries.value = []
    persist(entries.value)
    return removed
  }

  function setTtlDays(value: number): void {
    const clamped = Math.max(1, Math.min(365, Math.floor(value)))
    ttlDays.value = clamped
  }

  function forKind(kind: RecycleEntityKind): RecycledEntry[] {
    return entries.value.filter((e) => e.kind === kind)
  }

  const total = computed(() => entries.value.length)

  function $reset(): void {
    entries.value = []
    ttlDays.value = DEFAULT_TTL_DAYS
    persist([])
  }

  return {
    entries,
    ttlDays,
    total,
    rememberDelete,
    purge,
    purgeExpired,
    purgeAll,
    setTtlDays,
    forKind,
    $reset,
  }
})
