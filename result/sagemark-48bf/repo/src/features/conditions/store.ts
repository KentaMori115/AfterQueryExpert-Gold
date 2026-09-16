import { defineStore } from 'pinia'
import { ref } from 'vue'

import type { CharacterId } from '@core/ids'
import { getStore } from '@core/persistence/storage'
import {
  type Condition,
  type ConditionState,
  bumpExhaustion as bump,
  emptyConditionState,
  withCondition,
  withoutCondition,
} from '@core/rules/conditions'

const STORAGE_KEY = 'conditions:v1'

interface SerialState {
  byCharacter: Record<string, ConditionState>
}

function load(): SerialState {
  const raw = getStore().get(STORAGE_KEY)
  if (!raw) return { byCharacter: {} }
  try {
    const parsed = JSON.parse(raw) as SerialState
    if (parsed && parsed.byCharacter) return parsed
  } catch {
    return { byCharacter: {} }
  }
  return { byCharacter: {} }
}

function persist(state: SerialState): void {
  getStore().set(STORAGE_KEY, JSON.stringify(state))
}

function clone(state: SerialState): SerialState {
  return { byCharacter: { ...state.byCharacter } }
}

export const useConditionStore = defineStore('conditions', () => {
  const state = ref<SerialState>(load())

  function get(characterId: CharacterId): ConditionState {
    return state.value.byCharacter[characterId] ?? emptyConditionState()
  }

  function apply(characterId: CharacterId, next: ConditionState): void {
    const updated = clone(state.value)
    updated.byCharacter[characterId] = next
    state.value = updated
    persist(state.value)
  }

  function add(characterId: CharacterId, condition: Condition): void {
    apply(characterId, withCondition(get(characterId), condition))
  }

  function remove(characterId: CharacterId, condition: Condition): void {
    apply(characterId, withoutCondition(get(characterId), condition))
  }

  function clear(characterId: CharacterId): void {
    if (!(characterId in state.value.byCharacter)) return
    const updated = clone(state.value)
    delete updated.byCharacter[characterId]
    state.value = updated
    persist(state.value)
  }

  function bumpExhaustion(characterId: CharacterId, delta: number): void {
    apply(characterId, bump(get(characterId), delta))
  }

  function shortRest(characterId: CharacterId): void {
    const current = get(characterId)
    // A short rest removes prone and grappled but does not lift exhaustion
    const cleared = current.active.filter((c) => c !== 'prone' && c !== 'grappled')
    apply(characterId, { ...current, active: cleared })
  }

  function longRest(characterId: CharacterId): void {
    const current = get(characterId)
    apply(characterId, {
      active: [],
      exhaustion: bump(current, -1).exhaustion,
    })
  }

  function $reset(): void {
    state.value = { byCharacter: {} }
    persist(state.value)
  }

  return {
    get,
    add,
    remove,
    clear,
    bumpExhaustion,
    shortRest,
    longRest,
    $reset,
  }
})
