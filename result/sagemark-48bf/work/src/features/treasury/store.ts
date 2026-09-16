import { defineStore } from 'pinia'
import { ref } from 'vue'

import type { CampaignId } from '@core/ids'
import { generateId } from '@core/ids'
import { getStore } from '@core/persistence/storage'
import {
  type CoinPurse,
  emptyPurse,
  add as addPurses,
  adjust,
  consolidateUp,
} from '@core/rules/coin'
import { asTimestamp, type ISOTimestamp } from '@core/time/timestamps'

const STORAGE_KEY = 'treasury:v1'

export type TreasuryDirection = 'deposit' | 'withdraw'

export interface TreasuryEntry {
  id: string
  campaignId: CampaignId
  direction: TreasuryDirection
  purse: CoinPurse
  reason: string
  at: ISOTimestamp
  party: ReadonlyArray<string>
}

interface SerialState {
  byCampaign: Record<string, { purse: CoinPurse; entries: TreasuryEntry[] }>
}

function load(): SerialState {
  const raw = getStore().get(STORAGE_KEY)
  if (!raw) return { byCampaign: {} }
  try {
    const parsed = JSON.parse(raw) as SerialState
    if (parsed && parsed.byCampaign) return parsed
  } catch {
    return { byCampaign: {} }
  }
  return { byCampaign: {} }
}

function persist(state: SerialState): void {
  getStore().set(STORAGE_KEY, JSON.stringify(state))
}

function clone(state: SerialState): SerialState {
  return { byCampaign: { ...state.byCampaign } }
}

function bucket(state: SerialState, campaignId: CampaignId) {
  return state.byCampaign[campaignId] ?? { purse: emptyPurse(), entries: [] }
}

export const useTreasuryStore = defineStore('treasury', () => {
  const state = ref<SerialState>(load())

  function purseFor(campaignId: CampaignId): CoinPurse {
    return bucket(state.value, campaignId).purse
  }

  function entriesFor(campaignId: CampaignId): TreasuryEntry[] {
    return bucket(state.value, campaignId).entries
  }

  function setPurse(campaignId: CampaignId, purse: CoinPurse): void {
    const next = clone(state.value)
    const current = bucket(next, campaignId)
    next.byCampaign[campaignId] = { ...current, purse }
    state.value = next
    persist(state.value)
  }

  function deposit(
    campaignId: CampaignId,
    purse: CoinPurse,
    reason: string,
    party: ReadonlyArray<string> = [],
  ): TreasuryEntry {
    const next = clone(state.value)
    const current = bucket(next, campaignId)
    const updatedPurse = addPurses(current.purse, purse)
    const entry: TreasuryEntry = {
      id: generateId('tre'),
      campaignId,
      direction: 'deposit',
      purse,
      reason: reason.trim(),
      at: asTimestamp(new Date()),
      party,
    }
    next.byCampaign[campaignId] = {
      purse: updatedPurse,
      entries: [...current.entries, entry],
    }
    state.value = next
    persist(state.value)
    return entry
  }

  function withdraw(
    campaignId: CampaignId,
    purse: CoinPurse,
    reason: string,
    party: ReadonlyArray<string> = [],
  ): TreasuryEntry {
    const next = clone(state.value)
    const current = bucket(next, campaignId)
    let working = current.purse
    for (const kind of ['cp', 'sp', 'ep', 'gp', 'pp'] as const) {
      if (purse[kind] > 0) {
        working = adjust(working, kind, -purse[kind])
      }
    }
    const entry: TreasuryEntry = {
      id: generateId('tre'),
      campaignId,
      direction: 'withdraw',
      purse,
      reason: reason.trim(),
      at: asTimestamp(new Date()),
      party,
    }
    next.byCampaign[campaignId] = {
      purse: working,
      entries: [...current.entries, entry],
    }
    state.value = next
    persist(state.value)
    return entry
  }

  function consolidate(campaignId: CampaignId): void {
    setPurse(campaignId, consolidateUp(purseFor(campaignId)))
  }

  function clearLog(campaignId: CampaignId): void {
    const next = clone(state.value)
    const current = bucket(next, campaignId)
    next.byCampaign[campaignId] = { ...current, entries: [] }
    state.value = next
    persist(state.value)
  }

  function $reset(): void {
    state.value = { byCampaign: {} }
    persist(state.value)
  }

  return {
    purseFor,
    entriesFor,
    setPurse,
    deposit,
    withdraw,
    consolidate,
    clearLog,
    $reset,
  }
})
