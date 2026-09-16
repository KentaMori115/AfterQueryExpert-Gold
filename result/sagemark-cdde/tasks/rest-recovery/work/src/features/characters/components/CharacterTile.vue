<script setup lang="ts">
import { computed } from 'vue'

import {
  type Character,
  dispositionLabel,
  dispositionTone,
  kindLabel,
} from '@core/models/character'
import { initials } from '@core/lib/format'
import StatusBadge from '@ui/primitives/StatusBadge.vue'

const props = withDefaults(
  defineProps<{
    character: Character
    dimDead?: boolean
  }>(),
  { dimDead: true },
)

const tone = computed(() => dispositionTone(props.character.disposition))
const subtitle = computed(() => {
  const c = props.character
  const bits: string[] = []
  if (c.ancestry) bits.push(c.ancestry)
  if (c.vocation) bits.push(c.vocation)
  if (c.level > 0) bits.push(`lvl ${c.level}`)
  return bits.join(' / ')
})

const faded = computed(() => props.dimDead && !props.character.alive)
</script>

<template>
  <article
    class="surface p-3 flex items-center gap-3"
    :class="faded ? 'opacity-60' : ''"
  >
    <div
      aria-hidden="true"
      class="w-10 h-10 rounded-full bg-parchment-200 text-parchment-800 flex items-center justify-center text-sm font-semibold"
    >
      {{ initials(character.name) }}
    </div>
    <div class="min-w-0 flex-1">
      <div class="flex items-center gap-2">
        <h3 class="text-base font-display text-ink-900 truncate">{{ character.name }}</h3>
        <span class="text-[10px] uppercase tracking-wider text-ink-400">
          {{ kindLabel(character.kind) }}
        </span>
        <span v-if="!character.alive" class="text-[10px] uppercase tracking-wider text-crimson-500">
          fallen
        </span>
      </div>
      <p v-if="subtitle" class="text-xs text-ink-500 truncate">{{ subtitle }}</p>
    </div>
    <StatusBadge :tone="tone">{{ dispositionLabel(character.disposition) }}</StatusBadge>
  </article>
</template>
