<script setup lang="ts">
import { computed } from 'vue'

import {
  type Faction,
  alignmentLabel,
  alignmentTone,
  influenceTierLabel,
  scopeLabel,
} from '@core/models/faction'
import StatusBadge from '@ui/primitives/StatusBadge.vue'

const props = defineProps<{
  faction: Faction
}>()

const tone = computed(() => alignmentTone(props.faction.alignment))
const tier = computed(() => influenceTierLabel(props.faction.influence))
const dim = computed(() => !props.faction.active)
</script>

<template>
  <article
    class="surface p-3 flex flex-col gap-2"
    :class="dim ? 'opacity-60' : ''"
  >
    <header class="flex items-start justify-between gap-2">
      <div class="min-w-0">
        <h3 class="text-base font-display text-ink-900 truncate">{{ faction.name }}</h3>
        <p v-if="faction.motto" class="text-xs italic text-ink-500 truncate">{{ faction.motto }}</p>
      </div>
      <StatusBadge :tone="tone">{{ alignmentLabel(faction.alignment) }}</StatusBadge>
    </header>
    <div class="flex items-center justify-between text-xs text-ink-500">
      <span>{{ scopeLabel(faction.scope) }}</span>
      <span>{{ tier }}</span>
    </div>
    <div class="h-1.5 rounded-full bg-parchment-200 overflow-hidden" aria-hidden="true">
      <div
        class="h-full bg-ember-500"
        :style="{ width: `${faction.influence}%` }"
      />
    </div>
  </article>
</template>
