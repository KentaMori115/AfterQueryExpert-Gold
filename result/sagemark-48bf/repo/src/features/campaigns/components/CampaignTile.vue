<script setup lang="ts">
import { computed } from 'vue'

import { type Campaign, statusLabel, systemLabel } from '@core/models/campaign'
import { relativeFromNow } from '@core/time/timestamps'
import { pluralize } from '@core/lib/format'
import StatusBadge from '@ui/primitives/StatusBadge.vue'

const props = defineProps<{
  campaign: Campaign
  active?: boolean
}>()

const tone = computed(() => {
  switch (props.campaign.status) {
    case 'active':
      return 'success'
    case 'planning':
      return 'info'
    case 'paused':
      return 'warning'
    case 'finished':
      return 'accent'
    case 'archived':
      return 'neutral'
    default:
      return 'neutral'
  }
})

const lastPlayed = computed(() => {
  const ts = props.campaign.lastPlayedAt
  if (!ts) return 'no sessions yet'
  return `last played ${relativeFromNow(ts)}`
})
</script>

<template>
  <article
    class="surface p-4 flex flex-col gap-2"
    :class="active ? 'ring-2 ring-ember-400' : ''"
  >
    <header class="flex items-start justify-between gap-3">
      <div class="min-w-0">
        <h3 class="text-lg font-display text-ink-900 truncate">{{ campaign.name }}</h3>
        <p v-if="campaign.tagline" class="text-sm text-ink-500 truncate">
          {{ campaign.tagline }}
        </p>
      </div>
      <StatusBadge :tone="tone">{{ statusLabel(campaign.status) }}</StatusBadge>
    </header>
    <dl class="text-xs text-ink-500 grid grid-cols-2 gap-y-1 mt-1">
      <dt class="sr-only">System</dt>
      <dd>{{ systemLabel(campaign.system) }}</dd>
      <dt class="sr-only">Sessions</dt>
      <dd class="text-right">{{ pluralize(campaign.sessionCount, 'session') }}</dd>
      <dt class="sr-only">Last played</dt>
      <dd class="col-span-2">{{ lastPlayed }}</dd>
    </dl>
  </article>
</template>
