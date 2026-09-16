<script setup lang="ts">
import { computed, ref } from 'vue'

import { buildSeededRng } from '@core/dice/roll'
import { formatNpcSeed, generateNpcSeed, type NpcSeed } from '@core/generators/npc-tables'

import BaseButton from '@ui/primitives/BaseButton.vue'

const emit = defineEmits<{
  (e: 'adopt', seed: NpcSeed): void
}>()

const seedNumber = ref<number>(Math.floor(Math.random() * 1_000_000))
const seedInput = ref<string>(String(seedNumber.value))

const currentSeed = computed<NpcSeed>(() => generateNpcSeed(buildSeededRng(seedNumber.value)))
const formatted = computed(() => formatNpcSeed(currentSeed.value))

function applySeedInput(): void {
  const parsed = Number(seedInput.value)
  if (Number.isFinite(parsed) && parsed > 0) {
    seedNumber.value = Math.floor(parsed)
  }
}

function rerollRandom(): void {
  seedNumber.value = Math.floor(Math.random() * 1_000_000)
  seedInput.value = String(seedNumber.value)
}

function bump(delta: number): void {
  seedNumber.value = Math.max(1, seedNumber.value + delta)
  seedInput.value = String(seedNumber.value)
}

function adopt(): void {
  emit('adopt', currentSeed.value)
}
</script>

<template>
  <div class="space-y-3">
    <div class="flex flex-wrap items-end gap-3 text-xs">
      <label class="text-ink-500">
        Seed
        <input
          id="npc-seed"
          v-model="seedInput"
          type="number"
          min="1"
          class="mt-1 w-28 border border-parchment-300 rounded-soft px-2 py-1 bg-white"
          @change="applySeedInput"
        />
      </label>
      <BaseButton size="sm" @click="bump(-1)">previous</BaseButton>
      <BaseButton size="sm" @click="bump(1)">next</BaseButton>
      <BaseButton size="sm" tone="primary" @click="rerollRandom">random</BaseButton>
      <BaseButton size="sm" @click="adopt">adopt as character</BaseButton>
    </div>

    <article class="surface p-4 space-y-2">
      <h3 class="font-display text-lg text-ink-900">{{ currentSeed.name }}</h3>
      <p class="text-sm text-ink-700">
        <span class="text-ink-500">Vocation: </span>{{ currentSeed.vocation }}
      </p>
      <p class="text-sm text-ink-700">
        <span class="text-ink-500">Disposition: </span>{{ currentSeed.disposition }}
      </p>
      <p class="text-sm text-ink-700">
        <span class="text-ink-500">Quirk: </span>{{ currentSeed.quirk }}
      </p>
      <p class="text-sm text-ink-700">
        <span class="text-ink-500">Wants: </span>{{ currentSeed.motivation }}
      </p>
      <pre class="mt-2 text-xs text-ink-500 whitespace-pre-line">{{ formatted }}</pre>
    </article>
  </div>
</template>
