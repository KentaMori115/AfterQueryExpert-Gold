import { defineStore } from 'pinia'
import { ref } from 'vue'

import type { CampaignId, LocationId } from '@core/ids'
import { getStore } from '@core/persistence/storage'

const STORAGE_KEY = 'map:coords:v1'

export interface PlacedLocation {
  campaignId: CampaignId
  locationId: LocationId
  x: number
  y: number
}

interface SerialState {
  byKey: Record<string, PlacedLocation>
}

function keyFor(campaignId: CampaignId, locationId: LocationId): string {
  return `${campaignId}:${locationId}`
}

function load(): SerialState {
  const raw = getStore().get(STORAGE_KEY)
  if (!raw) return { byKey: {} }
  try {
    const parsed = JSON.parse(raw) as SerialState
    if (parsed && parsed.byKey) return parsed
  } catch {
    return { byKey: {} }
  }
  return { byKey: {} }
}

function persist(state: SerialState): void {
  getStore().set(STORAGE_KEY, JSON.stringify(state))
}

function clone(state: SerialState): SerialState {
  return { byKey: { ...state.byKey } }
}

export const useMapStore = defineStore('map', () => {
  const state = ref<SerialState>(load())

  function placement(campaignId: CampaignId, locationId: LocationId): PlacedLocation | null {
    return state.value.byKey[keyFor(campaignId, locationId)] ?? null
  }

  function forCampaign(campaignId: CampaignId): PlacedLocation[] {
    return Object.values(state.value.byKey).filter((p) => p.campaignId === campaignId)
  }

  function placeAt(campaignId: CampaignId, locationId: LocationId, x: number, y: number): void {
    const next = clone(state.value)
    next.byKey[keyFor(campaignId, locationId)] = {
      campaignId,
      locationId,
      x: Math.round(x),
      y: Math.round(y),
    }
    state.value = next
    persist(state.value)
  }

  function remove(campaignId: CampaignId, locationId: LocationId): void {
    const k = keyFor(campaignId, locationId)
    if (!(k in state.value.byKey)) return
    const next = clone(state.value)
    delete next.byKey[k]
    state.value = next
    persist(state.value)
  }

  function clearCampaign(campaignId: CampaignId): number {
    let removed = 0
    const next = clone(state.value)
    for (const k of Object.keys(next.byKey)) {
      if (next.byKey[k]?.campaignId === campaignId) {
        delete next.byKey[k]
        removed += 1
      }
    }
    state.value = next
    persist(state.value)
    return removed
  }

  function $reset(): void {
    state.value = { byKey: {} }
    persist(state.value)
  }

  return {
    placement,
    forCampaign,
    placeAt,
    remove,
    clearCampaign,
    $reset,
  }
})
