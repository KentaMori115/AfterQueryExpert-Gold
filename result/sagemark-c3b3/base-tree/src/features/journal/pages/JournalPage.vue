<script setup lang="ts">
import { computed, reactive, ref } from 'vue'

import {
  JOURNAL_MOODS,
  type JournalMood,
  moodLabel,
  moodTone,
} from '@core/models/journal'
import { relativeFromNow } from '@core/time/timestamps'

import { useCampaignStore } from '@features/campaigns/store'

import BaseButton from '@ui/primitives/BaseButton.vue'
import BreadcrumbTrail from '@ui/primitives/BreadcrumbTrail.vue'
import EmptyState from '@ui/primitives/EmptyState.vue'
import PageHeader from '@ui/primitives/PageHeader.vue'
import StatusBadge from '@ui/primitives/StatusBadge.vue'
import SurfaceCard from '@ui/primitives/SurfaceCard.vue'

import { useJournalStore } from '../store'

const campaigns = useCampaignStore()
const store = useJournalStore()

const filterCampaign = ref<string | 'any' | 'global'>('any')

const filtered = computed(() => {
  if (filterCampaign.value === 'any') return store.all
  if (filterCampaign.value === 'global') return store.forCampaign(null)
  return store.forCampaign(filterCampaign.value as never)
})

const streakMood = computed<JournalMood | null>(() => {
  if (filterCampaign.value === 'any') return null
  const id = filterCampaign.value === 'global' ? null : (filterCampaign.value as never)
  return store.streakFor(id)
})

const draft = reactive<{
  title: string
  body: string
  mood: JournalMood
  campaignId: string | 'global'
  pinned: boolean
}>({
  title: '',
  body: '',
  mood: 'steady',
  campaignId: 'global',
  pinned: false,
})

const lastError = ref<string | null>(null)

function add(): void {
  try {
    store.create({
      campaignId: draft.campaignId === 'global' ? null : draft.campaignId,
      title: draft.title,
      body: draft.body,
      mood: draft.mood,
      pinned: draft.pinned,
    })
    draft.title = ''
    draft.body = ''
    draft.pinned = false
    lastError.value = null
  } catch (err) {
    lastError.value = err instanceof Error ? err.message : 'failed'
  }
}

function togglePin(id: string): void {
  store.togglePin(id)
}

function remove(id: string): void {
  if (!window.confirm('Forget this entry?')) return
  store.remove(id)
}

const crumbs = [
  { to: '/', label: 'Home' },
  { label: 'Journal' },
]
</script>

<template>
  <section class="container-wide py-8 space-y-6 max-w-3xl">
    <BreadcrumbTrail :crumbs="crumbs" />
    <PageHeader
      title="GM journal"
      subtitle="A private log only you see."
      :meta="store.all.length + ' entries'"
    />

    <SurfaceCard title="View">
      <div class="flex flex-wrap items-center gap-2 text-xs">
        <label class="text-ink-500">
          Filter
          <select
            id="journal-filter"
            v-model="filterCampaign"
            class="ml-2 border border-parchment-300 rounded-soft px-2 py-1 bg-white"
          >
            <option value="any">all</option>
            <option value="global">global</option>
            <option v-for="c in campaigns.all" :key="c.id" :value="c.id">{{ c.name }}</option>
          </select>
        </label>
        <StatusBadge v-if="streakMood" :tone="moodTone(streakMood)">
          mood streak: {{ moodLabel(streakMood) }}
        </StatusBadge>
      </div>
    </SurfaceCard>

    <SurfaceCard title="Log an entry">
      <form class="grid grid-cols-2 sm:grid-cols-4 gap-2" @submit.prevent="add">
        <input
          id="journal-title"
          v-model="draft.title"
          type="text"
          placeholder="Title"
          class="sm:col-span-2 border border-parchment-300 rounded-soft px-2 py-1 text-sm bg-white"
        />
        <select
          v-model="draft.mood"
          class="border border-parchment-300 rounded-soft px-2 py-1 text-sm bg-white"
        >
          <option v-for="m in JOURNAL_MOODS" :key="m" :value="m">{{ moodLabel(m) }}</option>
        </select>
        <select
          v-model="draft.campaignId"
          class="border border-parchment-300 rounded-soft px-2 py-1 text-sm bg-white"
        >
          <option value="global">global</option>
          <option v-for="c in campaigns.all" :key="c.id" :value="c.id">{{ c.name }}</option>
        </select>
        <textarea
          v-model="draft.body"
          rows="3"
          placeholder="What is on your mind"
          class="sm:col-span-4 border border-parchment-300 rounded-soft px-2 py-1 text-sm bg-white"
        />
        <label class="sm:col-span-2 flex items-center gap-2 text-xs">
          <input v-model="draft.pinned" type="checkbox" /> pin to top
        </label>
        <div class="sm:col-span-2 flex justify-end">
          <BaseButton size="sm" tone="primary" type="submit">log</BaseButton>
        </div>
      </form>
      <p v-if="lastError" class="mt-2 text-sm text-crimson-600">{{ lastError }}</p>
    </SurfaceCard>

    <EmptyState
      v-if="filtered.length === 0"
      title="No entries here"
      description="Jot a note after every session, even one line."
    />
    <ul v-else class="space-y-3">
      <li v-for="entry in filtered" :key="entry.id" class="surface p-3 space-y-1">
        <header class="flex flex-wrap items-center gap-2">
          <span class="font-display text-ink-900">{{ entry.title }}</span>
          <StatusBadge :tone="moodTone(entry.mood)">{{ moodLabel(entry.mood) }}</StatusBadge>
          <StatusBadge v-if="entry.pinned" tone="warning">pinned</StatusBadge>
          <span class="ml-auto flex gap-2 text-xs">
            <button class="text-ink-600 hover:text-ink-900" @click="togglePin(entry.id)">
              {{ entry.pinned ? 'unpin' : 'pin' }}
            </button>
            <button class="text-crimson-600 hover:text-crimson-800" @click="remove(entry.id)">forget</button>
          </span>
        </header>
        <p class="text-sm text-ink-700 whitespace-pre-line">{{ entry.body }}</p>
        <p class="text-xs text-ink-400">{{ relativeFromNow(entry.createdAt) }}</p>
      </li>
    </ul>
  </section>
</template>
