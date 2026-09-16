<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink, useRoute } from 'vue-router'

import type { CampaignId } from '@core/ids'
import { formatGold } from '@core/models/item'

import { useCampaignStore } from '@features/campaigns/store'

import BreadcrumbTrail from '@ui/primitives/BreadcrumbTrail.vue'
import EmptyState from '@ui/primitives/EmptyState.vue'
import PageHeader from '@ui/primitives/PageHeader.vue'
import StatusBadge from '@ui/primitives/StatusBadge.vue'
import SurfaceCard from '@ui/primitives/SurfaceCard.vue'

import { useCampaignReports } from '../useReports'

const route = useRoute()
const campaigns = useCampaignStore()

const campaignIdFromRoute = computed(() => route.params.campaignId as string)
const campaign = computed(() => campaigns.all.find((c) => c.id === campaignIdFromRoute.value))

const reports = useCampaignReports(() =>
  campaign.value ? (campaign.value.id as CampaignId) : null,
)

const maxSessionsInAMonth = computed(() => {
  let max = 0
  for (const m of reports.sessionsByMonth.value) {
    if (m.count > max) max = m.count
  }
  return max
})

const maxInfluence = computed(() => {
  let max = 0
  for (const f of reports.factionInfluence.value) {
    if (f.influence > max) max = f.influence
  }
  return max
})

function sessionsBarPct(count: number): number {
  if (maxSessionsInAMonth.value === 0) return 0
  return Math.round((count / maxSessionsInAMonth.value) * 100)
}

function influencePct(value: number): number {
  if (maxInfluence.value === 0) return 0
  return Math.round((value / maxInfluence.value) * 100)
}

const crumbs = computed(() => [
  { to: '/', label: 'Home' },
  { to: '/campaigns', label: 'Campaigns' },
  {
    to: campaign.value ? `/campaigns/${campaign.value.id}` : '/campaigns',
    label: campaign.value?.name ?? 'Unknown',
  },
  { label: 'Reports' },
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
      <PageHeader title="Reports" subtitle="A glance at where the campaign sits." />

      <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SurfaceCard title="Open quests" hint="Quests not yet resolved">
          <p class="text-3xl font-display text-ink-900">{{ reports.openQuestCount }}</p>
        </SurfaceCard>
        <SurfaceCard title="Live arcs" hint="Arcs still in motion">
          <p class="text-3xl font-display text-ink-900">{{ reports.liveArcCount }}</p>
        </SurfaceCard>
        <SurfaceCard title="Hidden lore" hint="Not yet revealed">
          <p class="text-3xl font-display text-ink-900">{{ reports.unrevealedLoreCount }}</p>
        </SurfaceCard>
        <SurfaceCard title="Treasury" hint="Sum of recorded loot value">
          <p class="text-3xl font-display text-ink-900">{{ formatGold(reports.totalLootGp) }}</p>
        </SurfaceCard>
      </div>

      <SurfaceCard title="Sessions per month">
        <EmptyState
          v-if="reports.sessionsByMonth.length === 0"
          title="No sessions logged yet"
          description="Log a session to start seeing your cadence."
        />
        <ul v-else class="space-y-2 text-sm">
          <li
            v-for="m in reports.sessionsByMonth"
            :key="m.key"
            class="flex items-center gap-3"
          >
            <span class="w-24 shrink-0 text-ink-500">{{ m.label }}</span>
            <div class="flex-1 h-3 rounded-full bg-parchment-200 overflow-hidden" aria-hidden="true">
              <div class="h-full bg-ember-500" :style="{ width: sessionsBarPct(m.count) + '%' }" />
            </div>
            <span class="w-8 text-right text-ink-700 tabular-nums">{{ m.count }}</span>
          </li>
        </ul>
      </SurfaceCard>

      <SurfaceCard title="Faction influence">
        <EmptyState
          v-if="reports.factionInfluence.length === 0"
          title="No factions"
          description="Add a faction to start mapping the politics."
        />
        <ul v-else class="space-y-2 text-sm">
          <li
            v-for="f in reports.factionInfluence"
            :key="f.name"
            class="flex items-center gap-3"
          >
            <span class="w-32 shrink-0 text-ink-800 truncate">{{ f.name }}</span>
            <StatusBadge v-if="!f.active" tone="neutral">Dormant</StatusBadge>
            <div class="flex-1 h-3 rounded-full bg-parchment-200 overflow-hidden" aria-hidden="true">
              <div class="h-full bg-crimson-500" :style="{ width: influencePct(f.influence) + '%' }" />
            </div>
            <span class="w-12 text-right text-ink-700 tabular-nums">{{ f.influence }}</span>
          </li>
        </ul>
      </SurfaceCard>

      <SurfaceCard title="The cast">
        <dl class="grid grid-cols-3 gap-3 text-sm">
          <div>
            <dt class="text-xs uppercase tracking-wider text-ink-400">Players</dt>
            <dd class="text-2xl font-display text-ink-900">{{ reports.partyComposition.pcs }}</dd>
          </div>
          <div>
            <dt class="text-xs uppercase tracking-wider text-ink-400">NPCs alive</dt>
            <dd class="text-2xl font-display text-ink-900">{{ reports.partyComposition.npcsAlive }}</dd>
          </div>
          <div>
            <dt class="text-xs uppercase tracking-wider text-ink-400">NPCs fallen</dt>
            <dd class="text-2xl font-display text-ink-900">{{ reports.partyComposition.npcsFallen }}</dd>
          </div>
        </dl>
      </SurfaceCard>
    </template>
  </section>
</template>
