import { defineStore } from 'pinia'
import { ref } from 'vue'

import type { CharacterId } from '@core/ids'
import { getStore } from '@core/persistence/storage'
import {
  type VoicePace,
  type VoicePitch,
  type VoiceProfile,
  type VoiceVolume,
  emptyVoice,
} from '@core/models/voice-profile'
import { asTimestamp } from '@core/time/timestamps'

const STORAGE_KEY = 'voices:v1'

interface SerialState {
  byCharacter: Record<string, VoiceProfile>
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

export const useVoiceStore = defineStore('voices', () => {
  const state = ref<SerialState>(load())

  function get(characterId: CharacterId): VoiceProfile {
    return state.value.byCharacter[characterId] ?? emptyVoice(characterId, asTimestamp(new Date()))
  }

  function set(characterId: CharacterId, profile: VoiceProfile): void {
    const next = clone(state.value)
    next.byCharacter[characterId] = { ...profile, updatedAt: asTimestamp(new Date()) }
    state.value = next
    persist(state.value)
  }

  function setPitch(characterId: CharacterId, pitch: VoicePitch): void {
    set(characterId, { ...get(characterId), pitch })
  }

  function setPace(characterId: CharacterId, pace: VoicePace): void {
    set(characterId, { ...get(characterId), pace })
  }

  function setVolume(characterId: CharacterId, volume: VoiceVolume): void {
    set(characterId, { ...get(characterId), volume })
  }

  function setText(
    characterId: CharacterId,
    field: 'catchphrase' | 'quirk' | 'accent',
    value: string,
  ): void {
    set(characterId, { ...get(characterId), [field]: value.trim() })
  }

  function clear(characterId: CharacterId): void {
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
    set,
    setPitch,
    setPace,
    setVolume,
    setText,
    clear,
    $reset,
  }
})
