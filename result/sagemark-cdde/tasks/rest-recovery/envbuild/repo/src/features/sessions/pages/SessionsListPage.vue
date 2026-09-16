<script setup lang="ts">
import { computed, ref } from 'vue'
import { RouterLink, useRoute } from 'vue-router'

import type { CampaignId } from '@core/ids'

import { useCampaignStore } from '@features/campaigns/store'
import { useSessionStore } from '../store'
import SessionCard from '../components/SessionCard.vue'

import BaseButton from '@ui/primitives/BaseButton.vue'
import BreadcrumbTrail from '@ui/primitives/BreadcrumbTrail.vue'
import EmptyState from '@ui/primitives/EmptyState.vue'
import PageHeader from '@ui/primitives/PageHeader.vue'
import SurfaceCard from '@ui/primitives/SurfaceCard.vue'

const route = useRoute()
const campaigns = useCampaignStore()
const sessions = useSessionStore()

const campaignIdFromRoute = computed(() => route.params.campaignId as string)
const campaign = computed(() => campaigns.all.find((c) => c.id === campaignIdFromRoute.value))

const monthFilter = ref<string>('')

const ordered = computed(() => {
  if (!campaign.value) return []
  // Reverse-chronological reads more naturally on a list page
  const list = [...sessions.chronologicalFor(campaign.value.id as CampaignId)].reverse()
  if (!monthFilter.value) return list
  return list.filter((s) => s.playedAt.startsWith(monthFilter.value))
})

const monthOptions = computed<string[]>(() => {
  if (!campaign.value) return []
  const seen = new Set<string>()
  for (const s of sessions.forCampaign(campaign.value.id as CampaignId)) {
    seen.add(s.playedAt.slice(0, 7))
  }
  return Array.from(seen).sort((a, b) => (b < a ? -1 : 1))
})

const crumbs = computed(() => [
  { to: '/', label: 'Home' },
  { to: '/campaigns', label: 'Campaigns' },
  {
    to: campaign.value ? `/campaigns/${campaign.value.id}` : '/campaigns',
    label: campaign.value?.name ?? 'Unknown',
  },
  { label: 'Sessions' },
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
        title="Sessions"
        subtitle="The campaign in order, newest at the top."
        :meta="ordered.length + ' logged'"
      >
        <RouterLink :to="`/campaigns/${campaign.id}/prep`" class="mr-2">
          <BaseButton>Prep next</BaseButton>
        </RouterLink>
        <RouterLink :to="`/campaigns/${campaign.id}/sessions/new`">
          <BaseButton tone="primary">Log a session</BaseButton>
        </RouterLink>
      </PageHeader>

      <SurfaceCard v-if="monthOptions.length > 1" title="Filter">
        <label class="text-xs text-ink-500 flex items-center gap-2">
          Month
          <select
            id="session-month-filter"
            v-model="monthFilter"
            class="border border-parchment-300 rounded-soft px-2 py-1 text-sm bg-white"
          >
            <option value="">any</option>
            <option v-for="m in monthOptions" :key="m" :value="m">{{ m }}</option>
          </select>
        </label>
      </SurfaceCard>

      <EmptyState
        v-if="ordered.length === 0"
        title="No sessions yet"
        description="As soon as you play one, drop the date and a sentence about what happened."
        icon="*"
      >
        <template #action>
          <RouterLink :to="`/campaigns/${campaign.id}/sessions/new`">
            <BaseButton tone="primary">Log the first</BaseButton>
          </RouterLink>
        </template>
      </EmptyState>

      <ul v-else class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <li v-for="s in ordered" :key="s.id">
          <RouterLink
            :to="`/campaigns/${campaign.id}/sessions/${s.id}`"
            class="block focus:outline-none focus-visible:ring-2 focus-visible:ring-ember-400 rounded-soft"
          >
            <SessionCard :session="s" />
          </RouterLink>
        </li>
      </ul>
    </template>
  </section>
</template>
