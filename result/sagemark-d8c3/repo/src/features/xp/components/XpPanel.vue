<script setup lang="ts">
import { computed, reactive, ref } from 'vue'

import type { CampaignId, CharacterId } from '@core/ids'
import {
  DEFAULT_LEVEL_THRESHOLDS,
  maxLevel,
  progressFromXp,
} from '@core/rules/leveling'
import {
  XP_ENTRY_KINDS,
  kindLabel,
  summariseEntry,
  type XpEntry,
  type XpEntryKind,
} from '@core/models/xp-log'
import { relativeFromNow } from '@core/time/timestamps'

import BaseButton from '@ui/primitives/BaseButton.vue'
import StatusBadge from '@ui/primitives/StatusBadge.vue'

import { useXpStore } from '../store'

const props = defineProps<{
  campaignId: CampaignId
  characterId: CharacterId
}>()

const store = useXpStore()

const total = computed(() => store.totalFor(props.characterId))
const entries = computed<XpEntry[]>(() => [...store.forCharacter(props.characterId)].reverse())
const progress = computed(() => progressFromXp(total.value))
const cap = computed(() => maxLevel())

const draft = reactive<{ amount: number; kind: XpEntryKind; reason: string }>({
  amount: 100,
  kind: 'award',
  reason: '',
})

const lastError = ref<string | null>(null)

function commit(): void {
  lastError.value = null
  try {
    const payload = {
      campaignId: props.campaignId,
      characterId: props.characterId,
      amount: Number(draft.amount),
      reason: draft.reason || undefined,
    }
    if (draft.kind === 'award') store.recordAward(payload)
    else if (draft.kind === 'deduct') store.recordDeduct(payload)
    else store.recordMilestone(payload)
    draft.reason = ''
  } catch (err) {
    lastError.value = err instanceof Error ? err.message : 'something went wrong'
  }
}

function remove(entry: XpEntry): void {
  if (!window.confirm('Remove this xp entry?')) return
  store.remove(entry.id)
}

function nextThresholdLabel(): string {
  const p = progress.value
  if (p.xpForNextLevel === null) return `Max level ${cap.value}`
  return `${p.xpIntoLevel} of ${p.xpForNextLevel - (DEFAULT_LEVEL_THRESHOLDS.find((t) => t.level === p.level)?.xp ?? 0)} xp toward level ${p.level + 1}`
}
</script>

<template>
  <div class="space-y-3">
    <header class="flex flex-wrap items-center justify-between gap-2">
      <div>
        <h3 class="text-sm uppercase tracking-wider text-ink-400">Experience</h3>
        <p class="text-xs text-ink-500">
          {{ total }} xp total &middot; level {{ progress.level }} / {{ cap }} &middot;
          {{ nextThresholdLabel() }}
        </p>
      </div>
      <StatusBadge tone="info">L{{ progress.level }}</StatusBadge>
    </header>

    <div class="h-2 rounded-full bg-parchment-200 overflow-hidden" aria-hidden="true">
      <div
        class="h-full bg-ember-500 transition-all"
        :style="{ width: (progress.pct * 100).toFixed(1) + '%' }"
      />
    </div>

    <form class="grid grid-cols-1 sm:grid-cols-4 gap-2 text-xs" @submit.prevent="commit">
      <label class="text-ink-500">
        Kind
        <select
          id="xp-kind"
          v-model="draft.kind"
          class="mt-1 w-full border border-parchment-300 rounded-soft px-2 py-1 bg-white"
        >
          <option v-for="k in XP_ENTRY_KINDS" :key="k" :value="k">{{ kindLabel(k) }}</option>
        </select>
      </label>
      <label class="text-ink-500">
        Amount
        <input
          id="xp-amount"
          v-model.number="draft.amount"
          type="number"
          min="0"
          class="mt-1 w-full border border-parchment-300 rounded-soft px-2 py-1 bg-white"
        />
      </label>
      <label class="text-ink-500 sm:col-span-2">
        Reason
        <input
          id="xp-reason"
          v-model="draft.reason"
          type="text"
          placeholder="completed quest, paid debt..."
          class="mt-1 w-full border border-parchment-300 rounded-soft px-2 py-1 bg-white"
        />
      </label>
      <div class="sm:col-span-4 flex justify-end">
        <BaseButton tone="primary" size="sm" type="submit">Record</BaseButton>
      </div>
    </form>
    <p v-if="lastError" class="text-xs text-crimson-600">{{ lastError }}</p>

    <details v-if="entries.length > 0">
      <summary class="text-xs text-ink-500 cursor-pointer">History ({{ entries.length }})</summary>
      <ul class="mt-2 space-y-1 text-xs">
        <li
          v-for="entry in entries"
          :key="entry.id"
          class="flex items-center gap-2 border-b border-parchment-200 pb-1"
        >
          <span class="text-ink-500 w-32 shrink-0">{{ relativeFromNow(entry.recordedAt) }}</span>
          <span class="flex-1 text-ink-800 truncate">{{ summariseEntry(entry) }}</span>
          <button
            class="text-crimson-600 hover:text-crimson-800"
            @click="remove(entry)"
          >
            remove
          </button>
        </li>
      </ul>
    </details>
  </div>
</template>
