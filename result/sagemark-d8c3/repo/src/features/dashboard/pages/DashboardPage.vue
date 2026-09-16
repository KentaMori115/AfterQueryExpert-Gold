<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink } from 'vue-router'

import { statusLabel } from '@core/models/campaign'
import { relativeFromNow } from '@core/time/timestamps'

import BreadcrumbTrail from '@ui/primitives/BreadcrumbTrail.vue'
import EmptyState from '@ui/primitives/EmptyState.vue'
import PageHeader from '@ui/primitives/PageHeader.vue'
import StatusBadge from '@ui/primitives/StatusBadge.vue'
import SurfaceCard from '@ui/primitives/SurfaceCard.vue'
import BaseButton from '@ui/primitives/BaseButton.vue'

import { useDashboardData } from '../useDashboardData'

const data = useDashboardData()

const crumbs = computed(() => [
  { to: '/', label: 'Home' },
  { label: 'Dashboard' },
])

function lastPlayedHint(at: string | null): string {
  if (!at) return 'never played'
  return `last played ${relativeFromNow(at)}`
}
</script>

<template>
  <section class="container-wide py-8 space-y-6">
    <BreadcrumbTrail :crumbs="crumbs" />
    <PageHeader title="Dashboard" subtitle="A glance across every campaign you keep alive." />

    <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <SurfaceCard title="Campaigns" hint="open vs total">
        <p class="text-3xl font-display text-ink-900">
          {{ data.openCampaigns.value }} / {{ data.totalCampaigns.value }}
        </p>
      </SurfaceCard>
      <SurfaceCard title="Sessions" hint="logged across all">
        <p class="text-3xl font-display text-ink-900">{{ data.totalSessions.value }}</p>
      </SurfaceCard>
      <SurfaceCard title="Open quests" hint="across every campaign">
        <p class="text-3xl font-display text-ink-900">{{ data.totalQuests.value }}</p>
      </SurfaceCard>
      <SurfaceCard title="Live arcs" hint="not yet resolved">
        <p class="text-3xl font-display text-ink-900">{{ data.totalArcs.value }}</p>
      </SurfaceCard>
    </div>

    <SurfaceCard
      v-if="data.mostRecentCampaign.value"
      :title="`Most recent: ${data.mostRecentCampaign.value.name}`"
      :hint="lastPlayedHint(data.mostRecentCampaign.value.lastPlayedAt)"
    >
      <div class="flex flex-wrap gap-2">
        <RouterLink :to="`/campaigns/${data.mostRecentCampaign.value.id}`">
          <BaseButton tone="primary">Open this campaign</BaseButton>
        </RouterLink>
        <RouterLink :to="`/campaigns/${data.mostRecentCampaign.value.id}/pulse`">
          <BaseButton>Pulse</BaseButton>
        </RouterLink>
        <RouterLink :to="`/campaigns/${data.mostRecentCampaign.value.id}/prep`">
          <BaseButton>Prep next</BaseButton>
        </RouterLink>
        <RouterLink :to="`/campaigns/${data.mostRecentCampaign.value.id}/recap`">
          <BaseButton>Recap</BaseButton>
        </RouterLink>
        <RouterLink :to="`/campaigns/${data.mostRecentCampaign.value.id}/treasury`">
          <BaseButton>Treasury</BaseButton>
        </RouterLink>
      </div>
    </SurfaceCard>

    <EmptyState
      v-if="data.summaries.value.length === 0"
      title="No campaigns yet"
      description="Create one to start seeing summaries here."
    >
      <template #action>
        <RouterLink to="/campaigns/new">
          <BaseButton tone="primary">New campaign</BaseButton>
        </RouterLink>
      </template>
    </EmptyState>

    <ul v-else class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <li v-for="summary in data.summaries.value" :key="summary.id">
        <RouterLink :to="`/campaigns/${summary.id}`" class="block">
          <article class="surface p-3 space-y-2 hover:bg-parchment-50">
            <header class="flex items-start justify-between gap-2">
              <h3 class="text-base font-display text-ink-900 truncate">{{ summary.name }}</h3>
              <StatusBadge tone="info">{{ statusLabel(summary.status as never) }}</StatusBadge>
            </header>
            <dl class="grid grid-cols-2 gap-1 text-xs text-ink-500">
              <dt class="sr-only">Sessions</dt>
              <dd>{{ summary.sessionCount }} sessions</dd>
              <dt class="sr-only">Cast</dt>
              <dd>{{ summary.cast }} in the cast</dd>
              <dt class="sr-only">Factions</dt>
              <dd>{{ summary.factions }} factions</dd>
              <dt class="sr-only">Open quests</dt>
              <dd>{{ summary.openQuests }} open quests</dd>
              <dt class="sr-only">Live arcs</dt>
              <dd>{{ summary.liveArcs }} live arcs</dd>
              <dt class="sr-only">Overdue notes</dt>
              <dd v-if="summary.overdueNotes > 0" class="text-crimson-600">
                {{ summary.overdueNotes }} overdue
              </dd>
            </dl>
            <p class="text-xs text-ink-400">{{ lastPlayedHint(summary.lastPlayedAt) }}</p>
          </article>
        </RouterLink>
      </li>
    </ul>
  </section>
</template>
