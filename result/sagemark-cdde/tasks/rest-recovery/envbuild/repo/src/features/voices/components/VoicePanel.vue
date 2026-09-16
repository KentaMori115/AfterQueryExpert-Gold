<script setup lang="ts">
import { computed } from 'vue'

import type { CharacterId } from '@core/ids'
import {
  VOICE_PACES,
  VOICE_PITCHES,
  VOICE_VOLUMES,
  type VoicePace,
  type VoicePitch,
  type VoiceVolume,
  summariseVoice,
} from '@core/models/voice-profile'

import { useVoiceStore } from '../store'

const props = defineProps<{ characterId: CharacterId }>()

const store = useVoiceStore()
const voice = computed(() => store.get(props.characterId))

function setPitch(p: VoicePitch): void {
  store.setPitch(props.characterId, p)
}

function setPace(p: VoicePace): void {
  store.setPace(props.characterId, p)
}

function setVolume(v: VoiceVolume): void {
  store.setVolume(props.characterId, v)
}

function update(field: 'catchphrase' | 'quirk' | 'accent', value: string): void {
  store.setText(props.characterId, field, value)
}
</script>

<template>
  <div class="space-y-3 text-sm">
    <section class="space-y-1">
      <h4 class="text-xs uppercase tracking-wide text-ink-500">Pitch</h4>
      <div class="flex flex-wrap gap-1">
        <button
          v-for="p in VOICE_PITCHES"
          :key="p"
          type="button"
          class="px-2 py-1 rounded-soft text-xs capitalize"
          :class="
            voice.pitch === p
              ? 'bg-ink-700 text-white'
              : 'bg-parchment-100 hover:bg-parchment-200 text-ink-700'
          "
          @click="setPitch(p)"
        >
          {{ p }}
        </button>
      </div>
    </section>

    <section class="space-y-1">
      <h4 class="text-xs uppercase tracking-wide text-ink-500">Pace</h4>
      <div class="flex flex-wrap gap-1">
        <button
          v-for="p in VOICE_PACES"
          :key="p"
          type="button"
          class="px-2 py-1 rounded-soft text-xs capitalize"
          :class="
            voice.pace === p
              ? 'bg-ink-700 text-white'
              : 'bg-parchment-100 hover:bg-parchment-200 text-ink-700'
          "
          @click="setPace(p)"
        >
          {{ p }}
        </button>
      </div>
    </section>

    <section class="space-y-1">
      <h4 class="text-xs uppercase tracking-wide text-ink-500">Volume</h4>
      <div class="flex flex-wrap gap-1">
        <button
          v-for="v in VOICE_VOLUMES"
          :key="v"
          type="button"
          class="px-2 py-1 rounded-soft text-xs capitalize"
          :class="
            voice.volume === v
              ? 'bg-ink-700 text-white'
              : 'bg-parchment-100 hover:bg-parchment-200 text-ink-700'
          "
          @click="setVolume(v)"
        >
          {{ v }}
        </button>
      </div>
    </section>

    <section class="space-y-1">
      <label class="text-xs text-ink-500">
        Accent
        <input
          id="voice-accent"
          :value="voice.accent"
          type="text"
          placeholder="optional"
          class="mt-1 w-full border border-parchment-300 rounded-soft px-2 py-1 bg-white"
          @change="update('accent', ($event.target as HTMLInputElement).value)"
        />
      </label>
    </section>

    <section class="space-y-1">
      <label class="text-xs text-ink-500">
        Catchphrase
        <input
          id="voice-catch"
          :value="voice.catchphrase"
          type="text"
          placeholder="something they always say"
          class="mt-1 w-full border border-parchment-300 rounded-soft px-2 py-1 bg-white"
          @change="update('catchphrase', ($event.target as HTMLInputElement).value)"
        />
      </label>
    </section>

    <section class="space-y-1">
      <label class="text-xs text-ink-500">
        Quirk
        <input
          id="voice-quirk"
          :value="voice.quirk"
          type="text"
          placeholder="a tic in their speech"
          class="mt-1 w-full border border-parchment-300 rounded-soft px-2 py-1 bg-white"
          @change="update('quirk', ($event.target as HTMLInputElement).value)"
        />
      </label>
    </section>

    <p class="text-xs text-ink-500 italic">{{ summariseVoice(voice) }}</p>
  </div>
</template>
