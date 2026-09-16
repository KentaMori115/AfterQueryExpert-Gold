<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink } from 'vue-router'

import { useCampaignStore } from '@features/campaigns/store'
import { statusLabel, systemLabel } from '@core/models/campaign'
import { relativeFromNow } from '@core/time/timestamps'
import { pluralize } from '@core/lib/format'

import BaseButton from '@ui/primitives/BaseButton.vue'
import EmptyState from '@ui/primitives/EmptyState.vue'
import PageHeader from '@ui/primitives/PageHeader.vue'
import StatusBadge from '@ui/primitives/StatusBadge.vue'
import SurfaceCard from '@ui/primitives/SurfaceCard.vue'

const store = useCampaignStore()

const active = computed(() => store.active)
const openCount = computed(() => store.open.length)
const totalCount = computed(() => store.all.length)

const playedHint = computed(() => {
  const c = active.value
  if (!c) return ''
  if (!c.lastPlayedAt) return 'No sessions logged yet.'
  return `Last played ${relativeFromNow(c.lastPlayedAt)}.`
})
</script>

<template>
  <section class="container-wide py-8 space-y-6">
    <PageHeader title="At a glance" subtitle="Where the campaign stands as of right now.">
      <RouterLink to="/campaigns">
        <BaseButton>All campaigns</BaseButton>
      </RouterLink>
    </PageHeader>

    <EmptyState
      v-if="!active"
      title="Pick up where you left off"
      :description="totalCount === 0
        ? 'You have not started a campaign yet.'
        : 'Open a campaign from the list to bring its details into view.'"
      icon="*"
    >
      <template #action>
        <RouterLink :to="totalCount === 0 ? '/campaigns/new' : '/campaigns'">
          <BaseButton tone="primary">
            {{ totalCount === 0 ? 'Start one' : 'Choose a campaign' }}
          </BaseButton>
        </RouterLink>
      </template>
    </EmptyState>

    <template v-else>
      <SurfaceCard>
        <template #header>
          <StatusBadge tone="success">{{ statusLabel(active.status) }}</StatusBadge>
        </template>
        <h2 class="text-2xl font-display text-ink-900">{{ active.name }}</h2>
        <p v-if="active.tagline" class="text-ink-600 mt-1">{{ active.tagline }}</p>
        <dl class="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
          <div>
            <dt class="text-xs uppercase tracking-wider text-ink-400">System</dt>
            <dd class="text-ink-800">{{ systemLabel(active.system) }}</dd>
          </div>
          <div>
            <dt class="text-xs uppercase tracking-wider text-ink-400">Sessions</dt>
            <dd class="text-ink-800">{{ pluralize(active.sessionCount, 'session') }}</dd>
          </div>
          <div>
            <dt class="text-xs uppercase tracking-wider text-ink-400">Activity</dt>
            <dd class="text-ink-800">{{ playedHint }}</dd>
          </div>
        </dl>
      </SurfaceCard>

      <SurfaceCard title="Quick links" hint="Jump to the parts of the campaign you touch most">
        <div class="flex flex-wrap gap-2">
          <RouterLink :to="`/campaigns/${active.id}/sessions`">
            <BaseButton size="sm">Sessions</BaseButton>
          </RouterLink>
          <RouterLink :to="`/campaigns/${active.id}/characters`">
            <BaseButton size="sm">Cast</BaseButton>
          </RouterLink>
          <RouterLink :to="`/campaigns/${active.id}/quests`">
            <BaseButton size="sm">Quests</BaseButton>
          </RouterLink>
          <RouterLink :to="`/campaigns/${active.id}/pulse`">
            <BaseButton size="sm">Pulse</BaseButton>
          </RouterLink>
          <RouterLink :to="`/campaigns/${active.id}/prep`">
            <BaseButton size="sm">Prep</BaseButton>
          </RouterLink>
          <RouterLink :to="`/campaigns/${active.id}/recap`">
            <BaseButton size="sm">Recap</BaseButton>
          </RouterLink>
          <RouterLink :to="`/campaigns/${active.id}/treasury`">
            <BaseButton size="sm">Treasury</BaseButton>
          </RouterLink>
          <RouterLink :to="`/campaigns/${active.id}/generators`">
            <BaseButton size="sm">Generators</BaseButton>
          </RouterLink>
        </div>
      </SurfaceCard>

      <p class="text-xs text-ink-400">
        Tracking {{ openCount }} of {{ totalCount }} {{ totalCount === 1 ? 'campaign' : 'campaigns' }}.
      </p>
    </template>
  </section>
</template>
