import { defineStore } from 'pinia'
import { ref } from 'vue'

import type { CharacterId } from '@core/ids'
import { generateId } from '@core/ids'
import { getStore } from '@core/persistence/storage'
import {
  type CoinKind,
  type CoinPurse,
  add as addPurses,
  adjust,
  consolidateUp,
  emptyPurse,
} from '@core/rules/coin'
import { asTimestamp, type ISOTimestamp } from '@core/time/timestamps'

const STORAGE_KEY = 'coin:purses:v1'

export interface CoinLedgerEntry {
  id: string
  characterId: CharacterId
  kind: CoinKind
  delta: number
  reason: string
  at: ISOTimestamp
}

interface SerialState {
  purses: Record<string, CoinPurse>
  ledger: CoinLedgerEntry[]
}

function load(): SerialState {
  const raw = getStore().get(STORAGE_KEY)
  if (!raw) return { purses: {}, ledger: [] }
  try {
    const parsed = JSON.parse(raw) as SerialState
    if (parsed && parsed.purses && Array.isArray(parsed.ledger)) return parsed
  } catch {
    return { purses: {}, ledger: [] }
  }
  return { purses: {}, ledger: [] }
}

function persist(state: SerialState): void {
  getStore().set(STORAGE_KEY, JSON.stringify(state))
}

function clone(state: SerialState): SerialState {
  return { purses: { ...state.purses }, ledger: [...state.ledger] }
}

export const useCoinStore = defineStore('coin', () => {
  const state = ref<SerialState>(load())

  function purseFor(characterId: CharacterId): CoinPurse {
    return state.value.purses[characterId] ?? emptyPurse()
  }

  function ledgerFor(characterId: CharacterId): CoinLedgerEntry[] {
    return state.value.ledger.filter((e) => e.characterId === characterId)
  }

  function setPurse(characterId: CharacterId, purse: CoinPurse): void {
    const next = clone(state.value)
    next.purses[characterId] = purse
    state.value = next
    persist(state.value)
  }

  function bump(characterId: CharacterId, kind: CoinKind, delta: number, reason: string): void {
    if (!Number.isFinite(delta) || delta === 0) return
    const next = clone(state.value)
    const before = purseFor(characterId)
    const after = adjust(before, kind, delta)
    next.purses[characterId] = after
    next.ledger.push({
      id: generateId('coin'),
      characterId,
      kind,
      delta: Math.floor(delta),
      reason: reason.trim(),
      at: asTimestamp(new Date()),
    })
    state.value = next
    persist(state.value)
  }

  function depositPurse(characterId: CharacterId, deposit: CoinPurse, reason: string): void {
    const before = purseFor(characterId)
    const after = addPurses(before, deposit)
    const next = clone(state.value)
    next.purses[characterId] = after
    for (const kind of Object.keys(deposit) as CoinKind[]) {
      if (deposit[kind] > 0) {
        next.ledger.push({
          id: generateId('coin'),
          characterId,
          kind,
          delta: deposit[kind],
          reason: reason.trim(),
          at: asTimestamp(new Date()),
        })
      }
    }
    state.value = next
    persist(state.value)
  }

  function consolidate(characterId: CharacterId): void {
    const before = purseFor(characterId)
    const after = consolidateUp(before)
    if (after === before) return
    setPurse(characterId, after)
  }

  function clearLedger(characterId: CharacterId): void {
    const next = clone(state.value)
    next.ledger = next.ledger.filter((e) => e.characterId !== characterId)
    state.value = next
    persist(state.value)
  }

  function $reset(): void {
    state.value = { purses: {}, ledger: [] }
    persist(state.value)
  }

  return {
    purseFor,
    ledgerFor,
    setPurse,
    bump,
    depositPurse,
    consolidate,
    clearLedger,
    $reset,
  }
})
