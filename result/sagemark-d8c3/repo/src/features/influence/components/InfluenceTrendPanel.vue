<script setup lang="ts">
import { computed, ref } from 'vue'

import type { CampaignId, FactionId } from '@core/ids'
import {
  buildSparklinePath,
  buildSparklinePoints,
  lastInfluence,
  trendDirection,
} from '@core/models/influence-snapshot'
import { relativeFromNow } from '@core/time/timestamps'

import BaseButton from '@ui/primitives/BaseButton.vue'
import StatusBadge from '@ui/primitives/StatusBadge.vue'

import { useInfluenceStore } from '../store'

const props = defineProps<{
  campaignId: CampaignId
  factionId: FactionId
  currentInfluence: number
  width?: number
  height?: number
}>()

const store = useInfluenceStore()
const noteDraft = ref('')

const snapshots = computed(() => store.forFaction(props.factionId))
const points = computed(() => buildSparklinePoints(snapshots.value, props.width ?? 240, props.height ?? 64))
const pathD = computed(() => buildSparklinePath(points.value))
const direction = computed(() => trendDirection(snapshots.value))
const latest = computed(() => lastInfluence(snapshots.value))

const trendTone = computed(() => {
  switch (direction.value) {
    case 'rising':
      return 'success'
    case 'falling':
      return 'danger'
    case 'flat':
      return 'info'
    default:
      return 'neutral'
  }
})

function captureSnapshot(): void {
  store.record({
    campaignId: props.campaignId,
    factionId: props.factionId,
    influence: props.currentInfluence,
    note: noteDraft.value || undefined,
  })
  noteDraft.value = ''
}

function removeSnapshot(id: string): void {
  if (!window.confirm('Drop this snapshot?')) return
  store.remove(id)
}
</script>

<template>
  <div class="space-y-3">
    <header class="flex flex-wrap items-center justify-between gap-2">
      <div>
        <h3 class="text-sm uppercase tracking-wider text-ink-400">Influence trend</h3>
        <p class="text-xs text-ink-500">
          {{ snapshots.length }} snapshots tracked
          <span v-if="latest"> &middot; last {{ relativeFromNow(latest.recordedAt) }}</span>
        </p>
      </div>
      <StatusBadge :tone="trendTone">{{ direction }}</StatusBadge>
    </header>

    <svg
      v-if="points.length > 0"
      :viewBox="`0 0 ${props.width ?? 240} ${props.height ?? 64}`"
      :width="props.width ?? 240"
      :height="props.height ?? 64"
      role="img"
      aria-label="Influence trend sparkline"
      class="block w-full"
    >
      <rect :width="props.width ?? 240" :height="props.height ?? 64" fill="#fbf7ee" stroke="#e8d6a8" />
      <path :d="pathD" stroke="#e1581a" stroke-width="2" fill="none" />
      <circle
        v-for="p in points"
        :key="p.recordedAt"
        :cx="p.x"
        :cy="p.y"
        r="2.5"
        fill="#e1581a"
      >
        <title>{{ p.influence }} on {{ p.recordedAt }}</title>
      </circle>
    </svg>
    <p v-else class="text-xs text-ink-400">No snapshots yet.</p>

    <form class="flex flex-wrap items-end gap-2" @submit.prevent="captureSnapshot">
      <label class="text-xs text-ink-500 flex-1 min-w-[160px]">
        Snapshot note (optional)
        <input
          id="influence-note"
          v-model="noteDraft"
          type="text"
          placeholder="why the change"
          class="mt-1 w-full border border-parchment-300 rounded-soft px-2 py-1 text-sm bg-white"
        />
      </label>
      <BaseButton tone="primary" size="sm" type="submit">Snapshot {{ currentInfluence }}</BaseButton>
    </form>

    <details v-if="snapshots.length > 0">
      <summary class="text-xs text-ink-500 cursor-pointer">History ({{ snapshots.length }})</summary>
      <ul class="mt-2 space-y-1 text-xs">
        <li
          v-for="s in [...snapshots].reverse()"
          :key="s.id"
          class="flex items-center gap-2 border-b border-parchment-200 pb-1"
        >
          <span class="font-mono text-ink-700 w-12">{{ s.influence }}</span>
          <span class="text-ink-500 w-24 shrink-0">{{ relativeFromNow(s.recordedAt) }}</span>
          <span class="flex-1 text-ink-700 truncate">{{ s.note || '' }}</span>
          <button
            class="text-crimson-600 hover:text-crimson-800"
            @click="removeSnapshot(s.id)"
          >
            remove
          </button>
        </li>
      </ul>
    </details>
  </div>
</template>
