import { defineStore } from 'pinia'
import { ref } from 'vue'

import type { CharacterId } from '@core/ids'
import { getStore } from '@core/persistence/storage'
import {
  type SpellLevel,
  type SpellSlotState,
  emptySpellSlotState,
  longRest as longRestPure,
  restore as restorePure,
  spellSlotStateFor,
  spend as spendPure,
} from '@core/rules/spell-slots'

const STORAGE_KEY = 'spellSlots:v1'

interface SerialState {
  byCharacter: Record<string, SpellSlotState>
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

export const useSpellSlotStore = defineStore('spellSlots', () => {
  const state = ref<SerialState>(load())

  function get(characterId: CharacterId): SpellSlotState {
    return state.value.byCharacter[characterId] ?? emptySpellSlotState()
  }

  function set(characterId: CharacterId, next: SpellSlotState): void {
    const updated = clone(state.value)
    updated.byCharacter[characterId] = next
    state.value = updated
    persist(state.value)
  }

  function bootstrap(characterId: CharacterId, casterLevel: number): SpellSlotState {
    const fresh = spellSlotStateFor(casterLevel)
    set(characterId, fresh)
    return fresh
  }

  function spend(characterId: CharacterId, level: SpellLevel): void {
    set(characterId, spendPure(get(characterId), level))
  }

  function restore(characterId: CharacterId, level: SpellLevel, amount = 1): void {
    set(characterId, restorePure(get(characterId), level, amount))
  }

  function longRest(characterId: CharacterId): void {
    set(characterId, longRestPure(get(characterId)))
  }

  function shortRest(characterId: CharacterId): void {
    // Short rest does not refill regular slots, but warlocks would here.
    // Leaving as a no op keeps the API symmetric with future expansion.
    void characterId
  }

  function clear(characterId: CharacterId): void {
    if (!(characterId in state.value.byCharacter)) return
    const updated = clone(state.value)
    delete updated.byCharacter[characterId]
    state.value = updated
    persist(state.value)
  }

  function $reset(): void {
    state.value = { byCharacter: {} }
    persist(state.value)
  }

  return {
    get,
    set,
    bootstrap,
    spend,
    restore,
    longRest,
    shortRest,
    clear,
    $reset,
  }
})
