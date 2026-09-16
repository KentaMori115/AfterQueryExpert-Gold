<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'

import type { CampaignId } from '@core/ids'

import { useCampaignStore } from '@features/campaigns/store'

import BreadcrumbTrail from '@ui/primitives/BreadcrumbTrail.vue'
import EmptyState from '@ui/primitives/EmptyState.vue'
import PageHeader from '@ui/primitives/PageHeader.vue'
import StatusBadge from '@ui/primitives/StatusBadge.vue'
import SurfaceCard from '@ui/primitives/SurfaceCard.vue'

import { usePulse, type PulseBeat } from '../usePulse'

const route = useRoute()
const campaigns = useCampaignStore()

const campaignIdFromRoute = computed(() => route.params.campaignId as string)
const campaign = computed(() => campaigns.all.find((c) => c.id === campaignIdFromRoute.value))

const { pulse } = usePulse({
  campaignId: () => (campaign.value ? (campaign.value.id as CampaignId) : null),
})

const beatTones: Record<PulseBeat['kind'], 'danger' | 'warning' | 'success' | 'info' | 'neutral'> = {
  'overdue-note': 'danger',
  'open-quest': 'info',
  'live-arc': 'warning',
  'unresolved-encounter': 'info',
  'fresh-session': 'success',
}

const freshnessTone: Record<'fresh' | 'stalling' | 'cold', 'success' | 'warning' | 'danger'> = {
  fresh: 'success',
  stalling: 'warning',
  cold: 'danger',
}

const crumbs = computed(() => [
  { to: '/', label: 'Home' },
  { to: '/campaigns', label: 'Campaigns' },
  {
    to: campaign.value ? `/campaigns/${campaign.value.id}` : '/campaigns',
    label: campaign.value?.name ?? 'Unknown',
  },
  { label: 'Pulse' },
])
</script>

<template>
  <section class="container-wide py-8 space-y-6 max-w-3xl">
    <BreadcrumbTrail :crumbs="crumbs" />

    <div v-if="!campaign" class="surface p-8 text-center">
      <h2 class="text-xl font-display text-ink-900">Campaign not found</h2>
    </div>

    <template v-else-if="pulse">
      <PageHeader
        title="Pulse"
        :subtitle="'A read on ' + pulse.campaignName + ' before next session.'"
      />

      <SurfaceCard title="Freshness">
        <div class="flex flex-wrap items-center gap-2 text-sm">
          <StatusBadge :tone="freshnessTone[pulse.freshness]" :soft="false">
            {{ pulse.freshness }}
          </StatusBadge>
          <span class="text-ink-500">
            {{
              pulse.daysSinceLastSession === null
                ? 'no session logged yet'
                : pulse.daysSinceLastSession + ' days since the last session'
            }}
          </span>
        </div>
      </SurfaceCard>

      <EmptyState
        v-if="pulse.beats.length === 0"
        title="Nothing pressing"
        description="No overdue notes, open quests, or live arcs flagged."
      />

      <SurfaceCard v-else title="Beats" hint="Sorted by what most demands attention">
        <ul class="space-y-1 text-sm">
          <li v-for="(beat, idx) in pulse.beats" :key="idx" class="flex flex-wrap items-center gap-2">
            <StatusBadge :tone="beatTones[beat.kind]">{{ beat.kind }}</StatusBadge>
            <span class="text-ink-800">{{ beat.title }}</span>
            <span class="text-ink-500">{{ beat.detail }}</span>
          </li>
        </ul>
      </SurfaceCard>
    </template>
  </section>
</template>
