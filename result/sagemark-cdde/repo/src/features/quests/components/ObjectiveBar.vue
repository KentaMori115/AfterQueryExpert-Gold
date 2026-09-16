<script setup lang="ts">
import { computed } from 'vue'

import { type Quest, objectiveProgress } from '@core/models/quest'

const props = defineProps<{ quest: Quest }>()

const progress = computed(() => objectiveProgress(props.quest))

const pct = computed(() => Math.round(progress.value.ratio * 100))

const tone = computed(() => {
  if (progress.value.total === 0) return 'bg-parchment-200'
  if (pct.value >= 100) return 'bg-moss-500'
  if (pct.value >= 50) return 'bg-ember-500'
  return 'bg-ink-700'
})
</script>

<template>
  <div class="space-y-1">
    <div class="flex justify-between text-xs text-ink-500">
      <span>objectives</span>
      <span class="font-mono">{{ progress.done }} / {{ progress.total }}</span>
    </div>
    <div class="h-1.5 w-full rounded-full bg-parchment-200 overflow-hidden">
      <div
        class="h-full"
        :class="tone"
        :style="{ width: pct + '%' }"
        :aria-valuenow="pct"
        role="progressbar"
        aria-valuemin="0"
        aria-valuemax="100"
      ></div>
    </div>
  </div>
</template>
