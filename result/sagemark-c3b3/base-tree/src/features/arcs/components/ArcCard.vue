<script setup lang="ts">
import { computed } from 'vue'

import {
  type Arc,
  statusLabel,
  statusTone,
  tensionBar,
  tensionLabel,
} from '@core/models/arc'
import StatusBadge from '@ui/primitives/StatusBadge.vue'

const props = defineProps<{
  arc: Arc
  compact?: boolean
}>()

const tone = computed(() => statusTone(props.arc.status))
const tensionWidth = computed(() => tensionBar(props.arc.tension))
</script>

<template>
  <article :class="['surface', compact ? 'p-2 text-sm' : 'p-3']">
    <header class="flex items-start justify-between gap-2">
      <div class="min-w-0">
        <h3 :class="[compact ? 'text-sm' : 'text-base', 'font-display text-ink-900 truncate']">
          {{ arc.title }}
        </h3>
        <p v-if="!compact && arc.synopsis" class="text-xs text-ink-500 line-clamp-2">
          {{ arc.synopsis }}
        </p>
      </div>
      <StatusBadge :tone="tone">{{ statusLabel(arc.status) }}</StatusBadge>
    </header>
    <div class="mt-2">
      <div class="flex items-center justify-between text-xs text-ink-500">
        <span>Tension</span>
        <span>{{ tensionLabel(arc.tension) }}</span>
      </div>
      <div class="h-1.5 rounded-full bg-parchment-200 overflow-hidden mt-1" aria-hidden="true">
        <div
          class="h-full bg-crimson-500"
          :style="{ width: `${tensionWidth}%` }"
        />
      </div>
    </div>
  </article>
</template>
