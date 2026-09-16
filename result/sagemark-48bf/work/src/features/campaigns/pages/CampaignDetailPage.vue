<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'

import type { CampaignId } from '@core/ids'
import { statusLabel, systemLabel } from '@core/models/campaign'
import { relativeFromNow } from '@core/time/timestamps'
import { pluralize } from '@core/lib/format'

import { useCampaignStore } from '../store'
import BaseButton from '@ui/primitives/BaseButton.vue'
import BreadcrumbTrail from '@ui/primitives/BreadcrumbTrail.vue'
import PageHeader from '@ui/primitives/PageHeader.vue'
import StatusBadge from '@ui/primitives/StatusBadge.vue'
import SurfaceCard from '@ui/primitives/SurfaceCard.vue'
import { useSessionStats } from '@features/sessions/useSessionStats'

const route = useRoute()
const router = useRouter()
const store = useCampaignStore()

const idFromRoute = computed(() => route.params.id as string)
const campaign = computed(() => store.all.find((c) => c.id === idFromRoute.value))

const crumbs = computed(() => [
  { to: '/', label: 'Home' },
  { to: '/campaigns', label: 'Campaigns' },
  { label: campaign.value?.name ?? 'Not found' },
])

const { stats: sessionStats } = useSessionStats({
  campaignId: () => (campaign.value ? (campaign.value.id as CampaignId) : null),
})

const lastPlayed = computed(() => {
  const c = campaign.value
  if (!c?.lastPlayedAt) return 'No sessions logged yet'
  return `Last played ${relativeFromNow(c.lastPlayedAt)}`
})

function activate(): void {
  if (campaign.value) store.setActive(campaign.value.id as CampaignId)
}

function archive(): void {
  if (campaign.value) store.setStatus(campaign.value.id as CampaignId, 'archived')
}

function unarchive(): void {
  if (campaign.value) store.setStatus(campaign.value.id as CampaignId, 'active')
}

function deleteCampaign(): void {
  if (!campaign.value) return
  if (!window.confirm(`Delete "${campaign.value.name}"? This cannot be undone.`)) return
  store.remove(campaign.value.id as CampaignId)
  router.push('/campaigns')
}
</script>

<template>
  <section class="container-wide py-8 space-y-6">
    <BreadcrumbTrail :crumbs="crumbs" />

    <div v-if="!campaign" class="surface p-8 text-center">
      <h2 class="text-xl font-display text-ink-900">Campaign not found</h2>
      <p class="text-ink-500 mt-1">It may have been deleted, or the link is wrong.</p>
      <RouterLink to="/campaigns" class="link mt-3 inline-block">Back to all campaigns</RouterLink>
    </div>

    <template v-else>
      <PageHeader :title="campaign.name" :subtitle="campaign.tagline || undefined">
        <RouterLink :to="`/campaigns/${campaign.id}/edit`">
          <BaseButton>Edit</BaseButton>
        </RouterLink>
        <BaseButton
          v-if="store.activeId !== campaign.id"
          tone="primary"
          @click="activate"
        >
          Make active
        </BaseButton>
      </PageHeader>

      <SurfaceCard>
        <template #header>
          <StatusBadge tone="success">{{ statusLabel(campaign.status) }}</StatusBadge>
        </template>
        <dl class="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
          <div>
            <dt class="text-xs uppercase tracking-wider text-ink-400">System</dt>
            <dd class="text-ink-800">{{ systemLabel(campaign.system) }}</dd>
          </div>
          <div>
            <dt class="text-xs uppercase tracking-wider text-ink-400">Sessions</dt>
            <dd class="text-ink-800">{{ pluralize(campaign.sessionCount, 'session') }}</dd>
          </div>
          <div>
            <dt class="text-xs uppercase tracking-wider text-ink-400">Activity</dt>
            <dd class="text-ink-800">{{ lastPlayed }}</dd>
          </div>
        </dl>
      </SurfaceCard>

      <SurfaceCard
        v-if="sessionStats && sessionStats.total > 0"
        title="Session pulse"
        hint="From the play log"
      >
        <dl class="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
          <div>
            <dt class="text-xs text-ink-500">Total</dt>
            <dd class="font-mono text-ink-800">{{ sessionStats.total }}</dd>
          </div>
          <div>
            <dt class="text-xs text-ink-500">Total minutes</dt>
            <dd class="font-mono text-ink-800">{{ sessionStats.totalMinutes }}</dd>
          </div>
          <div>
            <dt class="text-xs text-ink-500">Average minutes</dt>
            <dd class="font-mono text-ink-800">{{ sessionStats.averageMinutes }}</dd>
          </div>
          <div v-if="sessionStats.cadenceDays !== null">
            <dt class="text-xs text-ink-500">Cadence</dt>
            <dd class="font-mono text-ink-800">{{ sessionStats.cadenceDays }} days</dd>
          </div>
        </dl>
      </SurfaceCard>

      <SurfaceCard title="Danger zone" hint="One-way operations">
        <div class="flex flex-wrap gap-2">
          <BaseButton
            v-if="campaign.status !== 'archived'"
            @click="archive"
          >
            Archive
          </BaseButton>
          <BaseButton
            v-else
            @click="unarchive"
          >
            Unarchive
          </BaseButton>
          <BaseButton tone="danger" @click="deleteCampaign">
            Delete forever
          </BaseButton>
        </div>
      </SurfaceCard>
    </template>
  </section>
</template>
