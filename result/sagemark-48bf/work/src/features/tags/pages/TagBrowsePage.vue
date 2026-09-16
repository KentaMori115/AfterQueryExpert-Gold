<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink, useRoute } from 'vue-router'

import type { CampaignId, TagId } from '@core/ids'
import type { TagTargetKind } from '@core/models/tag'

import { useCampaignStore } from '@features/campaigns/store'

import BreadcrumbTrail from '@ui/primitives/BreadcrumbTrail.vue'
import EmptyState from '@ui/primitives/EmptyState.vue'
import PageHeader from '@ui/primitives/PageHeader.vue'
import SurfaceCard from '@ui/primitives/SurfaceCard.vue'

import TagChip from '../components/TagChip.vue'
import { useTagStore } from '../store'
import { useTagFilter } from '../useTagFilter'

const route = useRoute()
const campaigns = useCampaignStore()
const tags = useTagStore()

const campaignIdFromRoute = computed(() => route.params.campaignId as string)
const campaign = computed(() => campaigns.all.find((c) => c.id === campaignIdFromRoute.value))

const filter = useTagFilter({
  campaignId: () =>
    campaign.value ? (campaign.value.id as CampaignId) : null,
})

const allTags = computed(() =>
  campaign.value ? tags.forCampaign(campaign.value.id as CampaignId) : [],
)

const crumbs = computed(() => [
  { to: '/', label: 'Home' },
  { to: '/campaigns', label: 'Campaigns' },
  {
    to: campaign.value ? `/campaigns/${campaign.value.id}` : '/campaigns',
    label: campaign.value?.name ?? 'Unknown',
  },
  {
    to: campaign.value ? `/campaigns/${campaign.value.id}/tags` : '/campaigns',
    label: 'Tags',
  },
  { label: 'Browse' },
])

const KIND_LABELS: Record<TagTargetKind, string> = {
  character: 'Cast',
  faction: 'Factions',
  location: 'World',
  session: 'Sessions',
  arc: 'Arcs',
  encounter: 'Encounters',
  lore: 'Lore',
  item: 'Items',
  quest: 'Quests',
}

function isSelected(id: TagId): boolean {
  return filter.selected.value.includes(id)
}
</script>

<template>
  <section class="container-wide py-8 space-y-6 max-w-3xl">
    <BreadcrumbTrail :crumbs="crumbs" />

    <div v-if="!campaign" class="surface p-8 text-center">
      <h2 class="text-xl font-display text-ink-900">Campaign not found</h2>
    </div>

    <template v-else>
      <PageHeader
        title="Browse by tag"
        subtitle="Pick one or more tags to see every target wearing them."
      />

      <SurfaceCard title="Pick tags">
        <div v-if="allTags.length === 0" class="text-sm text-ink-500">
          No tags yet. Mint some on the
          <RouterLink :to="`/campaigns/${campaign.id}/tags`" class="link">Tags page</RouterLink>.
        </div>
        <div v-else class="flex flex-wrap gap-1.5">
          <button
            v-for="tag in allTags"
            :key="tag.id"
            type="button"
            class="rounded-full p-0 bg-transparent border-0 leading-none"
            :aria-pressed="isSelected(tag.id as TagId)"
            :class="isSelected(tag.id as TagId) ? 'ring-2 ring-ink-700 rounded-full' : ''"
            @click="filter.toggle(tag.id as TagId)"
          >
            <TagChip :tag="tag" :interactive="true" />
          </button>
        </div>
        <div class="mt-3 flex flex-wrap gap-3 text-xs items-center">
          <span class="text-ink-500">Mode</span>
          <label class="flex items-center gap-1">
            <input
              type="radio"
              :value="'any'"
              :checked="filter.mode.value === 'any'"
              @change="filter.mode.value = 'any'"
            />
            any
          </label>
          <label class="flex items-center gap-1">
            <input
              type="radio"
              :value="'all'"
              :checked="filter.mode.value === 'all'"
              @change="filter.mode.value = 'all'"
            />
            all
          </label>
          <button
            v-if="filter.selected.value.length > 0"
            type="button"
            class="ml-auto underline text-ink-600 hover:text-ink-900"
            @click="filter.clear()"
          >
            clear
          </button>
        </div>
      </SurfaceCard>

      <EmptyState
        v-if="filter.selected.value.length === 0"
        title="Nothing picked"
        description="Choose at least one tag and the matching targets will appear."
      />
      <EmptyState
        v-else-if="filter.results.value.length === 0"
        title="No matches"
        description="Try widening to any, or pick a different tag."
      />

      <SurfaceCard
        v-else
        :title="filter.results.value.length + ' targets'"
        :hint="
          'Cast ' + filter.totals.value.character +
          ' | Factions ' + filter.totals.value.faction +
          ' | Places ' + filter.totals.value.location +
          ' | Quests ' + filter.totals.value.quest
        "
      >
        <ul class="space-y-2 text-sm">
          <li v-for="hit in filter.results.value" :key="hit.kind + ':' + hit.id" class="flex flex-wrap items-center gap-2">
            <span class="text-xs uppercase tracking-wide text-ink-400 w-20">{{ KIND_LABELS[hit.kind] }}</span>
            <RouterLink :to="hit.routeTo" class="link font-medium">{{ hit.name }}</RouterLink>
            <span class="flex gap-1">
              <TagChip v-for="t in hit.tags" :key="t.id" :tag="t" />
            </span>
          </li>
        </ul>
      </SurfaceCard>
    </template>
  </section>
</template>
