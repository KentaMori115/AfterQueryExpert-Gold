<script setup lang="ts">
import { computed, ref } from 'vue'

import { buildSeededRng } from '@core/dice/roll'
import { generateBatch, knownRegions } from '@core/generators/trinket-tables'

import BaseButton from '@ui/primitives/BaseButton.vue'
import StatusBadge from '@ui/primitives/StatusBadge.vue'

const seed = ref<number>(Math.floor(Math.random() * 1_000_000))
const count = ref<number>(5)
const region = ref<string>('')

const batch = computed(() =>
  generateBatch(buildSeededRng(seed.value), count.value, region.value || null),
)

function reroll(): void {
  seed.value = Math.floor(Math.random() * 1_000_000)
}
</script>

<template>
  <div class="space-y-3">
    <div class="flex flex-wrap items-end gap-2 text-xs">
      <label class="text-ink-500">
        Region
        <select
          id="trinket-region"
          v-model="region"
          class="mt-1 border border-parchment-300 rounded-soft px-2 py-1 bg-white"
        >
          <option value="">any</option>
          <option v-for="r in knownRegions()" :key="r" :value="r">{{ r }}</option>
        </select>
      </label>
      <label class="text-ink-500">
        Count
        <input
          id="trinket-count"
          v-model.number="count"
          type="number"
          min="1"
          max="20"
          class="mt-1 w-20 border border-parchment-300 rounded-soft px-2 py-1 bg-white"
        />
      </label>
      <BaseButton size="sm" tone="primary" @click="reroll">reroll</BaseButton>
    </div>

    <ul class="space-y-1 text-sm">
      <li v-for="(t, idx) in batch" :key="idx" class="flex items-start gap-2">
        <span class="font-mono w-8 text-ink-500">{{ idx + 1 }}.</span>
        <span class="flex-1 text-ink-800">{{ t.description }}</span>
        <StatusBadge v-if="t.region" tone="info">{{ t.region }}</StatusBadge>
      </li>
    </ul>
  </div>
</template>
