<script setup lang="ts">
import { computed, ref } from 'vue'

import type { CampaignId, SessionId } from '@core/ids'

import BaseButton from '@ui/primitives/BaseButton.vue'
import StatusBadge from '@ui/primitives/StatusBadge.vue'

import {
  PREP_ITEM_KINDS,
  PREP_KIND_LABELS,
  type PrepItemKind,
  usePrepStore,
} from '../store'

const props = defineProps<{
  campaignId: CampaignId
  sessionId: SessionId | null
}>()

const prep = usePrepStore()

const draftText = ref('')
const draftKind = ref<PrepItemKind>('scene')

const checklist = computed(() => prep.checklist(props.campaignId, props.sessionId))
const items = computed(() => checklist.value.items)
const progress = computed(() => prep.progress(props.campaignId, props.sessionId))

const grouped = computed(() => {
  const out: Record<PrepItemKind, typeof items.value> = {
    scene: [],
    npc: [],
    handout: [],
    reminder: [],
    rules: [],
    logistics: [],
  }
  for (const it of items.value) out[it.kind].push(it)
  return out
})

function addItem(): void {
  const text = draftText.value.trim()
  if (text.length === 0) return
  prep.addItem(props.campaignId, props.sessionId, draftKind.value, text)
  draftText.value = ''
}

function toggle(id: string): void {
  prep.toggleItem(props.campaignId, props.sessionId, id)
}

function remove(id: string): void {
  prep.removeItem(props.campaignId, props.sessionId, id)
}

function applyTemplate(): void {
  prep.applyTemplate(props.campaignId, props.sessionId)
}

function clearAll(): void {
  if (!window.confirm('Clear every prep item?')) return
  prep.clearList(props.campaignId, props.sessionId)
}
</script>

<template>
  <div class="space-y-4">
    <header class="flex flex-wrap items-center gap-3">
      <StatusBadge :tone="progress.pct === 100 ? 'success' : progress.pct >= 50 ? 'info' : 'neutral'">
        {{ progress.done }} / {{ progress.total }} ready
      </StatusBadge>
      <div class="flex-1 h-2 rounded-full bg-parchment-200 overflow-hidden min-w-[8rem]">
        <div class="h-full bg-moss-500" :style="{ width: progress.pct + '%' }"></div>
      </div>
      <BaseButton size="sm" @click="applyTemplate">add template</BaseButton>
      <BaseButton v-if="items.length > 0" size="sm" tone="danger" @click="clearAll">
        clear
      </BaseButton>
    </header>

    <form class="flex flex-wrap gap-2" @submit.prevent="addItem">
      <select
        id="prep-kind"
        v-model="draftKind"
        class="border border-parchment-300 rounded-soft px-2 py-1 text-sm bg-white"
      >
        <option v-for="k in PREP_ITEM_KINDS" :key="k" :value="k">{{ PREP_KIND_LABELS[k] }}</option>
      </select>
      <input
        v-model="draftText"
        type="text"
        placeholder="Reminder, prop, scene, ruling..."
        class="flex-1 border border-parchment-300 rounded-soft px-3 py-1 text-sm bg-white"
      />
      <BaseButton size="sm" tone="primary" type="submit">add</BaseButton>
    </form>

    <div v-if="items.length === 0" class="text-sm text-ink-500 italic">
      Nothing prepped yet. Hit "add template" for a starting set or scribble your own.
    </div>

    <template v-else>
      <section
        v-for="kind in PREP_ITEM_KINDS"
        v-show="grouped[kind].length > 0"
        :key="kind"
        class="space-y-1"
      >
        <h4 class="text-xs uppercase tracking-wide text-ink-500">{{ PREP_KIND_LABELS[kind] }}</h4>
        <ul class="space-y-1">
          <li
            v-for="item in grouped[kind]"
            :key="item.id"
            class="flex items-start gap-2 text-sm"
            :class="item.done ? 'text-ink-400 line-through' : 'text-ink-800'"
          >
            <input
              type="checkbox"
              :checked="item.done"
              class="mt-1"
              :aria-label="'Toggle ' + item.text"
              @change="toggle(item.id)"
            />
            <span class="flex-1">{{ item.text }}</span>
            <button
              type="button"
              class="text-xs text-crimson-600 hover:text-crimson-800"
              @click="remove(item.id)"
            >
              remove
            </button>
          </li>
        </ul>
      </section>
    </template>
  </div>
</template>
