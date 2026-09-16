<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink, useRoute } from 'vue-router'

import type { CampaignId } from '@core/ids'
import { ARC_STATUSES, statusLabel } from '@core/models/arc'

import { useCampaignStore } from '@features/campaigns/store'
import { useArcStore } from '../store'
import ArcCard from '../components/ArcCard.vue'

import BaseButton from '@ui/primitives/BaseButton.vue'
import BreadcrumbTrail from '@ui/primitives/BreadcrumbTrail.vue'
import EmptyState from '@ui/primitives/EmptyState.vue'
import PageHeader from '@ui/primitives/PageHeader.vue'

const route = useRoute()
const campaigns = useCampaignStore()
const arcs = useArcStore()

const campaignIdFromRoute = computed(() => route.params.campaignId as string)
const campaign = computed(() => campaigns.all.find((c) => c.id === campaignIdFromRoute.value))

const grouped = computed(() =>
  campaign.value
    ? arcs.groupedByStatus(campaign.value.id as CampaignId)
    : null,
)

const total = computed(() =>
  campaign.value ? arcs.forCampaign(campaign.value.id as CampaignId).length : 0,
)
const liveCount = computed(() =>
  campaign.value ? arcs.liveCountFor(campaign.value.id as CampaignId) : 0,
)

const crumbs = computed(() => [
  { to: '/', label: 'Home' },
  { to: '/campaigns', label: 'Campaigns' },
  {
    to: campaign.value ? `/campaigns/${campaign.value.id}` : '/campaigns',
    label: campaign.value?.name ?? 'Unknown',
  },
  { label: 'Arcs' },
])
</script>

<template>
  <section class="container-wide py-8 space-y-6">
    <BreadcrumbTrail :crumbs="crumbs" />

    <div v-if="!campaign" class="surface p-8 text-center">
      <h2 class="text-xl font-display text-ink-900">Campaign not found</h2>
      <RouterLink to="/campaigns" class="link mt-3 inline-block">Back</RouterLink>
    </div>

    <template v-else>
      <PageHeader
        title="Arcs"
        subtitle="The plotlines you're carrying."
        :meta="liveCount + ' in motion / ' + total + ' total'"
      >
        <RouterLink :to="`/campaigns/${campaign.id}/arcs/new`">
          <BaseButton tone="primary">New arc</BaseButton>
        </RouterLink>
      </PageHeader>

      <EmptyState
        v-if="total === 0"
        title="No arcs yet"
        description="A campaign is just sessions and arcs. Add one to start tracking the threads."
        icon="*"
      >
        <template #action>
          <RouterLink :to="`/campaigns/${campaign.id}/arcs/new`">
            <BaseButton tone="primary">Seed the first</BaseButton>
          </RouterLink>
        </template>
      </EmptyState>

      <div
        v-else-if="grouped"
        class="grid gap-3 sm:grid-cols-2 lg:grid-cols-5"
      >
        <section
          v-for="status in ARC_STATUSES"
          :key="status"
          class="surface p-2 min-h-[120px]"
        >
          <header class="flex items-center justify-between text-xs uppercase tracking-wider text-ink-400 mb-2">
            <span>{{ statusLabel(status) }}</span>
            <span class="text-ink-300">{{ grouped[status].length }}</span>
          </header>
          <ul class="space-y-2">
            <li v-for="a in grouped[status]" :key="a.id">
              <RouterLink
                :to="`/campaigns/${campaign.id}/arcs/${a.id}`"
                class="block focus:outline-none focus-visible:ring-2 focus-visible:ring-ember-400 rounded-soft"
              >
                <ArcCard :arc="a" compact />
              </RouterLink>
            </li>
          </ul>
        </section>
      </div>
    </template>
  </section>
</template>
