<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink } from 'vue-router'

import { flattenTree, kindLabel, type LocationNode } from '@core/models/location'

const props = defineProps<{
  tree: ReadonlyArray<LocationNode>
  routeBase: string // e.g. /campaigns/camp_X/locations
}>()

const flat = computed(() => flattenTree(props.tree))
</script>

<template>
  <ol v-if="flat.length > 0" class="space-y-1 text-sm">
    <li
      v-for="entry in flat"
      :key="entry.location.id"
      class="flex items-center gap-2"
      :style="{ paddingLeft: `${entry.depth * 1.25}rem` }"
    >
      <span class="text-ink-300" aria-hidden="true">{{ entry.depth === 0 ? '*' : '-' }}</span>
      <RouterLink
        :to="`${routeBase}/${entry.location.id}`"
        class="text-ink-800 hover:text-ember-600"
      >
        {{ entry.location.name }}
      </RouterLink>
      <span class="text-xs text-ink-400">{{ kindLabel(entry.location.kind) }}</span>
      <span v-if="entry.location.visited" class="text-xs text-moss-600">visited</span>
    </li>
  </ol>
  <p v-else class="text-sm text-ink-500">Nothing mapped yet.</p>
</template>
