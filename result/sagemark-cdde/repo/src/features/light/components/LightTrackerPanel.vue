<script setup lang="ts">
import { computed, ref } from 'vue'

import type { EncounterId } from '@core/ids'
import {
  LIGHT_SOURCES,
  VISIONS,
  type LightSource,
  type Vision,
  lightProfile,
  visionLabel,
} from '@core/rules/light'

import BaseButton from '@ui/primitives/BaseButton.vue'
import StatusBadge from '@ui/primitives/StatusBadge.vue'

import { useLightStore } from '../store'

const props = defineProps<{ encounterId: EncounterId }>()

const store = useLightStore()

const draftSource = ref<LightSource>('torch')
const draftCarrier = ref<string>('')
const draftVision = ref<Vision>('normal')

const tickMinutes = ref<number>(10)

const torches = computed(() => store.forEncounter(props.encounterId))

function add(): void {
  if (draftCarrier.value.trim().length === 0) {
    draftCarrier.value = 'someone'
  }
  store.add(props.encounterId, draftSource.value, draftCarrier.value, draftVision.value)
  draftCarrier.value = ''
}

function tickAll(): void {
  store.tick(props.encounterId, Math.max(0, Math.floor(tickMinutes.value)))
}

function snuff(id: string): void {
  store.snuff(props.encounterId, id)
}

function remove(id: string): void {
  store.remove(props.encounterId, id)
}

function setVision(id: string, vision: Vision): void {
  store.setVision(props.encounterId, id, vision)
}

function remainingLabel(minutes: number): string {
  if (!Number.isFinite(minutes)) return 'unlimited'
  if (minutes <= 0) return 'out'
  if (minutes < 60) return `${minutes}m`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m === 0 ? `${h}h` : `${h}h ${m}m`
}

function tone(minutes: number): 'success' | 'info' | 'warning' | 'danger' {
  if (!Number.isFinite(minutes)) return 'info'
  if (minutes <= 0) return 'danger'
  if (minutes <= 10) return 'warning'
  return 'success'
}
</script>

<template>
  <div class="space-y-3">
    <header class="flex flex-wrap items-end gap-2 text-xs">
      <label class="text-ink-500">
        Source
        <select
          id="light-source"
          v-model="draftSource"
          class="mt-1 border border-parchment-300 rounded-soft px-2 py-1 bg-white"
        >
          <option v-for="s in LIGHT_SOURCES" :key="s" :value="s">{{ lightProfile(s).label }}</option>
        </select>
      </label>
      <label class="text-ink-500">
        Carrier
        <input
          id="light-carrier"
          v-model="draftCarrier"
          type="text"
          placeholder="who holds it"
          class="mt-1 border border-parchment-300 rounded-soft px-2 py-1 bg-white"
        />
      </label>
      <label class="text-ink-500">
        Vision
        <select
          v-model="draftVision"
          class="mt-1 border border-parchment-300 rounded-soft px-2 py-1 bg-white"
        >
          <option v-for="v in VISIONS" :key="v" :value="v">{{ visionLabel(v) }}</option>
        </select>
      </label>
      <BaseButton size="sm" tone="primary" @click="add">add</BaseButton>
    </header>

    <div class="flex flex-wrap items-end gap-2 text-xs">
      <label class="text-ink-500">
        Tick all by (minutes)
        <input
          id="light-tick"
          v-model.number="tickMinutes"
          type="number"
          min="0"
          max="240"
          class="mt-1 w-20 border border-parchment-300 rounded-soft px-2 py-1 bg-white"
        />
      </label>
      <BaseButton size="sm" @click="tickAll">burn</BaseButton>
    </div>

    <ul v-if="torches.length > 0" class="space-y-2 text-sm">
      <li v-for="torch in torches" :key="torch.id" class="surface p-2 space-y-1">
        <div class="flex flex-wrap items-center gap-2">
          <StatusBadge :tone="tone(torch.remainingMinutes)">
            {{ remainingLabel(torch.remainingMinutes) }}
          </StatusBadge>
          <span class="font-display text-ink-900">{{ lightProfile(torch.source).label }}</span>
          <span class="text-ink-500">{{ torch.carrier }}</span>
          <span class="text-xs text-ink-400">{{ lightProfile(torch.source).brightFeet }} ft bright</span>
          <span class="ml-auto flex gap-2 text-xs">
            <button class="text-ink-600 hover:text-ink-900" @click="snuff(torch.id)">snuff</button>
            <button class="text-crimson-600 hover:text-crimson-800" @click="remove(torch.id)">remove</button>
          </span>
        </div>
        <div class="text-xs text-ink-500">
          Vision:
          <select
            class="ml-1 border border-parchment-300 rounded-soft px-1 py-0.5 bg-white"
            :value="torch.vision"
            @change="setVision(torch.id, ($event.target as HTMLSelectElement).value as Vision)"
          >
            <option v-for="v in VISIONS" :key="v" :value="v">{{ visionLabel(v) }}</option>
          </select>
        </div>
      </li>
    </ul>
    <p v-else class="text-sm text-ink-500 italic">No torches lit. Add one to start tracking.</p>
  </div>
</template>
