import { defineStore } from 'pinia'
import { ref } from 'vue'

import type { CharacterId } from '@core/ids'
import { getStore } from '@core/persistence/storage'
import {
  type PactSlots,
  type SpellLevel,
  type SpellSlotState,
  emptyPactSlots,
  emptySpellSlotState,
  longRest as longRestPure,
  pactSlotsFor,
  refillPact as refillPactPure,
  restore as restorePure,
  spellSlotStateFor,
  spend as spendPure,
  spendPact as spendPactPure,
} from '@core/rules/spell-slots'

const STORAGE_KEY = 'spellSlots:v1'

interface SerialState {
  byCharacter: Record<string, SpellSlotState>
  pactByCharacter?: Record<string, PactSlots>
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
  return {
    byCharacter: { ...state.byCharacter },
    pactByCharacter: { ...(state.pactByCharacter ?? {}) },
  }
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
    setPact(characterId, refillPactPure(getPact(characterId)))
  }

  function getPact(characterId: CharacterId): PactSlots {
    return state.value.pactByCharacter?.[characterId] ?? emptyPactSlots()
  }

  function setPact(characterId: CharacterId, next: PactSlots): void {
    const updated = clone(state.value)
    updated.pactByCharacter = { ...(updated.pactByCharacter ?? {}), [characterId]: next }
    state.value = updated
    persist(state.value)
  }

  function bootstrapPact(characterId: CharacterId, level: SpellLevel, max: number): PactSlots {
    const fresh = pactSlotsFor(level, max)
    setPact(characterId, fresh)
    return fresh
  }

  function spendPact(characterId: CharacterId): void {
    setPact(characterId, spendPactPure(getPact(characterId)))
  }

  function shortRest(characterId: CharacterId): void {
    // Ordinary slots stay where they are; pact slots come back from any rest.
    setPact(characterId, refillPactPure(getPact(characterId)))
  }

  function clear(characterId: CharacterId): void {
    if (!(characterId in state.value.byCharacter)) return
    const updated = clone(state.value)
    delete updated.byCharacter[characterId]
    state.value = updated
    persist(state.value)
  }

  function $reset(): void {
    state.value = { byCharacter: {}, pactByCharacter: {} }
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
    getPact,
    setPact,
    bootstrapPact,
    spendPact,
    clear,
    $reset,
  }
})
