<script setup lang="ts">
import { computed } from 'vue'

import {
  type Encounter,
  difficultyLabel,
  difficultyTone,
  kindLabel,
} from '@core/models/encounter'
import StatusBadge from '@ui/primitives/StatusBadge.vue'

const props = defineProps<{
  encounter: Encounter
}>()

const tone = computed(() => difficultyTone(props.encounter.difficulty))
const dim = computed(() => props.encounter.resolved)
</script>

<template>
  <article
    class="surface p-3 flex flex-col gap-2"
    :class="dim ? 'opacity-60' : ''"
  >
    <header class="flex items-start justify-between gap-2">
      <div class="min-w-0">
        <h3 class="text-base font-display text-ink-900 truncate">{{ encounter.title }}</h3>
        <p class="text-xs text-ink-400">{{ kindLabel(encounter.kind) }}</p>
      </div>
      <StatusBadge :tone="tone">{{ difficultyLabel(encounter.difficulty) }}</StatusBadge>
    </header>
    <p v-if="encounter.summary" class="text-sm text-ink-600 line-clamp-2">{{ encounter.summary }}</p>
    <footer class="flex items-center justify-between text-xs text-ink-400">
      <span>{{ encounter.initiative.length }} in initiative</span>
      <span v-if="encounter.resolved">resolved</span>
      <span v-else>open</span>
    </footer>
  </article>
</template>
