import { defineStore } from 'pinia'
import { ref } from 'vue'

import type { CharacterId } from '@core/ids'
import { getStore } from '@core/persistence/storage'
import {
  type AbilityKey,
  type AbilityScores,
  type StatBlock,
  emptyStatBlock,
  heal as healStat,
  setMaxHp,
  takeDamage,
} from '@core/rules/stat-block'

const STORAGE_KEY = 'stats:blocks:v1'

interface SerialState {
  byCharacter: Record<string, StatBlock>
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

export const useStatBlockStore = defineStore('stats', () => {
  const state = ref<SerialState>(load())

  function get(characterId: CharacterId): StatBlock {
    return state.value.byCharacter[characterId] ?? emptyStatBlock()
  }

  function tryGet(characterId: CharacterId): StatBlock | null {
    return state.value.byCharacter[characterId] ?? null
  }

  function set(characterId: CharacterId, block: StatBlock): void {
    const next = clone(state.value)
    next.byCharacter[characterId] = block
    state.value = next
    persist(state.value)
  }

  function setAbility(characterId: CharacterId, key: AbilityKey, score: number): void {
    const block = get(characterId)
    const safe = Math.max(1, Math.min(30, Math.floor(score)))
    set(characterId, {
      ...block,
      abilities: { ...block.abilities, [key]: safe } as AbilityScores,
    })
  }

  function setAc(characterId: CharacterId, ac: number): void {
    const block = get(characterId)
    set(characterId, { ...block, ac: Math.max(0, Math.min(40, Math.floor(ac))) })
  }

  function setSpeed(characterId: CharacterId, speed: number): void {
    const block = get(characterId)
    set(characterId, { ...block, speed: Math.max(0, Math.min(200, Math.floor(speed))) })
  }

  function damage(characterId: CharacterId, amount: number): void {
    const block = get(characterId)
    set(characterId, takeDamage(block, amount))
  }

  function heal(characterId: CharacterId, amount: number): void {
    const block = get(characterId)
    set(characterId, healStat(block, amount))
  }

  function configureMax(characterId: CharacterId, max: number): void {
    const block = get(characterId)
    set(characterId, setMaxHp(block, max))
  }

  function fullRest(characterId: CharacterId): void {
    const block = get(characterId)
    set(characterId, { ...block, hp: block.hpMax })
  }

  function remove(characterId: CharacterId): void {
    if (!(characterId in state.value.byCharacter)) return
    const next = clone(state.value)
    delete next.byCharacter[characterId]
    state.value = next
    persist(state.value)
  }

  function $reset(): void {
    state.value = { byCharacter: {} }
    persist(state.value)
  }

  return {
    get,
    tryGet,
    set,
    setAbility,
    setAc,
    setSpeed,
    damage,
    heal,
    configureMax,
    fullRest,
    remove,
    $reset,
  }
})
