import { defineStore } from 'pinia'
import { ref } from 'vue'

import type { EncounterId } from '@core/ids'
import { generateId } from '@core/ids'
import { getStore } from '@core/persistence/storage'
import {
  type LightSource,
  type Vision,
  burnDownMinutes,
  lightProfile,
} from '@core/rules/light'

const STORAGE_KEY = 'light:encounters:v1'

export interface LightTorch {
  id: string
  source: LightSource
  carrier: string
  remainingMinutes: number
  vision: Vision
}

interface SerialState {
  byEncounter: Record<string, LightTorch[]>
}

function load(): SerialState {
  const raw = getStore().get(STORAGE_KEY)
  if (!raw) return { byEncounter: {} }
  try {
    const parsed = JSON.parse(raw) as SerialState
    if (parsed && parsed.byEncounter) return parsed
  } catch {
    return { byEncounter: {} }
  }
  return { byEncounter: {} }
}

function persist(state: SerialState): void {
  getStore().set(STORAGE_KEY, JSON.stringify(state))
}

function clone(state: SerialState): SerialState {
  return { byEncounter: { ...state.byEncounter } }
}

export const useLightStore = defineStore('light', () => {
  const state = ref<SerialState>(load())

  function forEncounter(id: EncounterId): LightTorch[] {
    return state.value.byEncounter[id] ?? []
  }

  function setList(id: EncounterId, torches: LightTorch[]): void {
    const next = clone(state.value)
    next.byEncounter[id] = torches
    state.value = next
    persist(state.value)
  }

  function add(
    id: EncounterId,
    source: LightSource,
    carrier: string,
    vision: Vision = 'normal',
  ): LightTorch {
    const profile = lightProfile(source)
    const torch: LightTorch = {
      id: generateId('lit'),
      source,
      carrier: carrier.trim() || 'someone',
      remainingMinutes: profile.burnMinutes,
      vision,
    }
    setList(id, [...forEncounter(id), torch])
    return torch
  }

  function tick(id: EncounterId, minutes: number): void {
    if (minutes <= 0) return
    const next = forEncounter(id).map((t) => ({
      ...t,
      remainingMinutes: burnDownMinutes(t.remainingMinutes, minutes),
    }))
    setList(id, next)
  }

  function snuff(id: EncounterId, torchId: string): void {
    setList(
      id,
      forEncounter(id).map((t) =>
        t.id === torchId ? { ...t, remainingMinutes: 0 } : t,
      ),
    )
  }

  function remove(id: EncounterId, torchId: string): void {
    setList(id, forEncounter(id).filter((t) => t.id !== torchId))
  }

  function setVision(id: EncounterId, torchId: string, vision: Vision): void {
    setList(id, forEncounter(id).map((t) => (t.id === torchId ? { ...t, vision } : t)))
  }

  function clear(id: EncounterId): void {
    const next = clone(state.value)
    delete next.byEncounter[id]
    state.value = next
    persist(state.value)
  }

  function $reset(): void {
    state.value = { byEncounter: {} }
    persist(state.value)
  }

  return {
    forEncounter,
    add,
    tick,
    snuff,
    remove,
    setVision,
    clear,
    $reset,
  }
})
