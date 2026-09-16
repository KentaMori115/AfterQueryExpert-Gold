<script setup lang="ts">
import { computed } from 'vue'

import { describeShortcut } from '@core/lib/keyboard'

import BreadcrumbTrail from '@ui/primitives/BreadcrumbTrail.vue'
import PageHeader from '@ui/primitives/PageHeader.vue'
import SurfaceCard from '@ui/primitives/SurfaceCard.vue'

interface ShortcutRow {
  combo: string
  description: string
}

interface Section {
  title: string
  rows: ShortcutRow[]
}

const sections = computed<Section[]>(() => [
  {
    title: 'Navigation',
    rows: [
      { combo: 'mod+k', description: 'Open the command palette' },
      { combo: 'shift+/', description: 'Open the command palette (the question mark key)' },
      { combo: 'mod+/', description: 'Open the dice roller from anywhere' },
    ],
  },
  {
    title: 'Editing',
    rows: [
      { combo: 'enter', description: 'Submit a focused form' },
      { combo: 'escape', description: 'Cancel a modal or clear focus' },
    ],
  },
  {
    title: 'Palette controls',
    rows: [
      { combo: 'arrowup', description: 'Highlight the previous result' },
      { combo: 'arrowdown', description: 'Highlight the next result' },
      { combo: 'enter', description: 'Run the highlighted result' },
      { combo: 'escape', description: 'Close the palette' },
    ],
  },
])

const crumbs = computed(() => [
  { to: '/', label: 'Home' },
  { label: 'Shortcuts' },
])
</script>

<template>
  <section class="container-wide py-8 space-y-6 max-w-2xl">
    <BreadcrumbTrail :crumbs="crumbs" />
    <PageHeader title="Keyboard shortcuts" subtitle="The fastest way around the app." />

    <SurfaceCard v-for="section in sections" :key="section.title" :title="section.title">
      <ul class="space-y-1 text-sm">
        <li
          v-for="row in section.rows"
          :key="row.combo + row.description"
          class="flex items-center gap-3"
        >
          <kbd class="font-mono bg-parchment-100 px-2 py-0.5 rounded-soft text-ink-700">{{ describeShortcut(row.combo) }}</kbd>
          <span class="text-ink-700">{{ row.description }}</span>
        </li>
      </ul>
    </SurfaceCard>
  </section>
</template>
