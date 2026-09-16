<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { RouterLink, useRouter } from 'vue-router'

import { registerHotkeys } from '@core/lib/keyboard'

import { useCampaignStore } from '@features/campaigns/store'
import CommandPalette from '@features/palette/components/CommandPalette.vue'

const navOpen = ref(false)
const paletteOpen = ref(false)
const campaigns = useCampaignStore()
const router = useRouter()

let disposeHotkeys: (() => void) | null = null

onMounted(() => {
  disposeHotkeys = registerHotkeys([
    {
      combos: ['mod+k', 'shift+/'],
      description: 'Open the command palette',
      handler: () => {
        paletteOpen.value = true
      },
    },
    {
      combos: ['mod+/'],
      description: 'Open the dice roller',
      handler: () => {
        router.push('/dice')
      },
    },
  ])
})

onBeforeUnmount(() => {
  if (disposeHotkeys) disposeHotkeys()
})

const navLinks = computed<Array<{ to: string; label: string }>>(() => {
  const links: Array<{ to: string; label: string }> = [
    { to: '/', label: 'Home' },
    { to: '/campaigns', label: 'Campaigns' },
  ]
  const active = campaigns.active
  if (active) {
    links.push({ to: `/campaigns/${active.id}/sessions`, label: 'Sessions' })
    links.push({ to: `/campaigns/${active.id}/encounters`, label: 'Encounters' })
    links.push({ to: `/campaigns/${active.id}/arcs`, label: 'Arcs' })
    links.push({ to: `/campaigns/${active.id}/characters`, label: 'Cast' })
    links.push({ to: `/campaigns/${active.id}/factions`, label: 'Factions' })
    links.push({ to: `/campaigns/${active.id}/locations`, label: 'World' })
    links.push({ to: `/campaigns/${active.id}/relationships`, label: 'Bonds' })
    links.push({ to: `/campaigns/${active.id}/lore`, label: 'Lore' })
    links.push({ to: `/campaigns/${active.id}/items`, label: 'Loot' })
    links.push({ to: `/campaigns/${active.id}/quests`, label: 'Quests' })
    links.push({ to: `/campaigns/${active.id}/timeline`, label: 'Timeline' })
    links.push({ to: `/campaigns/${active.id}/prep`, label: 'Prep' })
    links.push({ to: `/campaigns/${active.id}/downtime`, label: 'Downtime' })
    links.push({ to: `/campaigns/${active.id}/tags`, label: 'Tags' })
    links.push({ to: `/campaigns/${active.id}/search`, label: 'Search' })
    links.push({ to: `/campaigns/${active.id}/reports`, label: 'Reports' })
    links.push({ to: `/campaigns/${active.id}/notes`, label: 'Notes' })
    links.push({ to: `/campaigns/${active.id}/generators`, label: 'Generators' })
  }
  return links
})
</script>

<template>
  <div class="min-h-screen flex flex-col">
    <a
      href="#main-region"
      class="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:bg-ink-800 focus:text-white focus:px-3 focus:py-1 focus:rounded-soft"
    >
      Skip to main content
    </a>
    <header class="border-b border-parchment-200 bg-white">
      <div class="container-wide flex items-center justify-between py-3">
        <RouterLink to="/" class="flex items-center gap-2">
          <span class="text-2xl font-display text-ink-900">Sagemark</span>
        </RouterLink>
        <nav class="hidden md:flex items-center gap-4">
          <RouterLink
            v-for="link in navLinks"
            :key="link.to"
            :to="link.to"
            class="text-ink-700 hover:text-ink-900"
            active-class="text-ember-600"
          >
            {{ link.label }}
          </RouterLink>
          <span v-if="campaigns.active" class="text-xs text-ink-400 ml-2">
            in: {{ campaigns.active.name }}
          </span>
        </nav>
        <button
          type="button"
          class="md:hidden p-2 rounded-soft hover:bg-parchment-100"
          aria-label="Toggle navigation"
          @click="navOpen = !navOpen"
        >
          <span class="block w-5 h-0.5 bg-ink-800 mb-1"></span>
          <span class="block w-5 h-0.5 bg-ink-800 mb-1"></span>
          <span class="block w-5 h-0.5 bg-ink-800"></span>
        </button>
      </div>
      <div v-if="navOpen" class="md:hidden border-t border-parchment-200 bg-white">
        <div class="container-wide py-2 flex flex-col gap-1">
          <RouterLink
            v-for="link in navLinks"
            :key="link.to"
            :to="link.to"
            class="py-2 text-ink-700 hover:text-ink-900"
            @click="navOpen = false"
          >
            {{ link.label }}
          </RouterLink>
        </div>
      </div>
    </header>

    <main id="main-region" class="flex-1" tabindex="-1">
      <slot />
    </main>

    <footer class="border-t border-parchment-200 bg-white">
      <div class="container-wide py-4 text-sm text-ink-500 flex items-center justify-between gap-3">
        <span>Sagemark - a local-first campaign manager.</span>
        <div class="flex items-center gap-3">
          <RouterLink to="/shortcuts" class="text-xs text-ink-500 hover:text-ink-800">
            shortcuts
          </RouterLink>
          <button
            type="button"
            class="text-xs text-ink-500 hover:text-ink-800"
            @click="paletteOpen = true"
          >
            press ? to search
          </button>
        </div>
      </div>
    </footer>

    <CommandPalette :open="paletteOpen" @close="paletteOpen = false" />
  </div>
</template>
