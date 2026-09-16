<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink, useRoute } from 'vue-router'

import type { CampaignId } from '@core/ids'

import { useCampaignStore } from '@features/campaigns/store'

import BreadcrumbTrail from '@ui/primitives/BreadcrumbTrail.vue'
import EmptyState from '@ui/primitives/EmptyState.vue'
import PageHeader from '@ui/primitives/PageHeader.vue'
import StatusBadge from '@ui/primitives/StatusBadge.vue'
import SurfaceCard from '@ui/primitives/SurfaceCard.vue'

import { useGlobalSearch, type SearchResultKind } from '../useGlobalSearch'

const route = useRoute()
const campaigns = useCampaignStore()

const campaignIdFromRoute = computed(() => route.params.campaignId as string)
const campaign = computed(() => campaigns.all.find((c) => c.id === campaignIdFromRoute.value))

const { query, grouped } = useGlobalSearch(() =>
  campaign.value ? (campaign.value.id as CampaignId) : null,
)

const groupOrder: SearchResultKind[] = [
  'character',
  'faction',
  'location',
  'lore',
  'item',
  'quest',
  'session',
]

const totalResults = computed(() =>
  groupOrder.reduce((sum, k) => sum + grouped.value[k].length, 0),
)

const crumbs = computed(() => [
  { to: '/', label: 'Home' },
  { to: '/campaigns', label: 'Campaigns' },
  {
    to: campaign.value ? `/campaigns/${campaign.value.id}` : '/campaigns',
    label: campaign.value?.name ?? 'Unknown',
  },
  { label: 'Search' },
])

function groupLabel(kind: SearchResultKind): string {
  switch (kind) {
    case 'character':
      return 'Characters'
    case 'faction':
      return 'Factions'
    case 'location':
      return 'Places'
    case 'lore':
      return 'Lore'
    case 'item':
      return 'Items'
    case 'quest':
      return 'Quests'
    case 'session':
      return 'Sessions'
  }
}
</script>

<template>
  <section class="container-wide py-8 space-y-6">
    <BreadcrumbTrail :crumbs="crumbs" />

    <div v-if="!campaign" class="surface p-8 text-center">
      <h2 class="text-xl font-display text-ink-900">Campaign not found</h2>
      <RouterLink to="/campaigns" class="link mt-3 inline-block">Back</RouterLink>
    </div>

    <template v-else>
      <PageHeader title="Search the campaign" subtitle="Across characters, places, lore, loot, sessions, and more.">
        <input
          id="search-input"
          v-model="query"
          type="search"
          autocomplete="off"
          placeholder="Try a name, an item, a tag..."
          class="w-full sm:w-80 border border-parchment-300 rounded-soft px-3 py-1.5 text-sm bg-white"
        />
      </PageHeader>

      <p class="text-xs text-ink-500">
        {{ query ? totalResults + ' results' : 'Type something to start searching.' }}
      </p>

      <EmptyState
        v-if="query && totalResults === 0"
        title="Nothing matched"
        description="Try a different word or a tag. Search is case-insensitive."
      />

      <template v-else-if="query">
        <SurfaceCard
          v-for="kind in groupOrder"
          :key="kind"
          v-show="grouped[kind].length > 0"
          :title="groupLabel(kind)"
        >
          <ul class="space-y-1 text-sm">
            <li v-for="r in grouped[kind]" :key="r.id" class="flex items-center gap-2">
              <RouterLink :to="r.routeTo" class="link">{{ r.label }}</RouterLink>
              <StatusBadge tone="neutral">{{ r.hint }}</StatusBadge>
            </li>
          </ul>
        </SurfaceCard>
      </template>
    </template>
  </section>
</template>
