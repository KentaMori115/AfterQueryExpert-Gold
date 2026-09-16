<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink } from 'vue-router'

import type { CampaignId } from '@core/ids'

import { useBacklinks, type BacklinkHit } from '../useBacklinks'
import StatusBadge from '@ui/primitives/StatusBadge.vue'

const props = defineProps<{
  campaignId: CampaignId
  name: string
  title?: string
}>()

const { hits } = useBacklinks({
  campaignId: () => props.campaignId,
  targetName: () => props.name,
})

const grouped = computed(() => {
  const byKind: Record<BacklinkHit['kind'], BacklinkHit[]> = { note: [], lore: [], session: [] }
  for (const hit of hits.value) byKind[hit.kind].push(hit)
  return byKind
})

const total = computed(() => hits.value.length)

function badgeTone(kind: BacklinkHit['kind']): 'info' | 'warning' | 'success' {
  switch (kind) {
    case 'note':
      return 'info'
    case 'lore':
      return 'success'
    case 'session':
      return 'warning'
  }
}
</script>

<template>
  <section class="space-y-2">
    <h3 class="text-sm uppercase tracking-wider text-ink-400">
      {{ title ?? 'Mentioned in' }} ({{ total }})
    </h3>
    <p v-if="total === 0" class="text-xs text-ink-400">
      Mention this entry with double bracket syntax to wire it up here.
    </p>
    <template v-else>
      <div v-for="kind in ['note', 'lore', 'session'] as const" :key="kind">
        <ul v-if="grouped[kind].length > 0" class="space-y-1 text-sm">
          <li
            v-for="hit in grouped[kind]"
            :key="hit.id"
            class="flex items-start gap-2"
          >
            <StatusBadge :tone="badgeTone(hit.kind)">{{ hit.kind }}</StatusBadge>
            <div class="min-w-0 flex-1">
              <RouterLink :to="hit.routeTo" class="link truncate block">{{ hit.label }}</RouterLink>
              <p v-if="hit.preview" class="text-xs text-ink-500 truncate">{{ hit.preview }}</p>
            </div>
          </li>
        </ul>
      </div>
    </template>
  </section>
</template>
