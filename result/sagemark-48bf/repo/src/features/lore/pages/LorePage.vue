<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { RouterLink, useRoute } from 'vue-router'

import type { CampaignId, LoreId } from '@core/ids'
import {
  LORE_CATEGORIES,
  type LoreDraftInput,
  type LoreEntry,
  categoryLabel,
} from '@core/models/lore'

import { useCampaignStore } from '@features/campaigns/store'
import { useLoreStore } from '../store'

import BaseButton from '@ui/primitives/BaseButton.vue'
import BreadcrumbTrail from '@ui/primitives/BreadcrumbTrail.vue'
import EmptyState from '@ui/primitives/EmptyState.vue'
import PageHeader from '@ui/primitives/PageHeader.vue'
import StatusBadge from '@ui/primitives/StatusBadge.vue'
import SurfaceCard from '@ui/primitives/SurfaceCard.vue'
import MarkdownView from '@ui/primitives/MarkdownView.vue'

const route = useRoute()
const campaigns = useCampaignStore()
const lore = useLoreStore()

const campaignIdFromRoute = computed(() => route.params.campaignId as string)
const campaign = computed(() => campaigns.all.find((c) => c.id === campaignIdFromRoute.value))

const query = ref('')
const onlyTag = ref<string | null>(null)
const onlyCategory = ref<string>('')
const editingId = ref<LoreId | null>(null)

const entries = computed(() => {
  if (!campaign.value) return [] as LoreEntry[]
  const allForCampaign = lore.forCampaign(campaign.value.id as CampaignId)
  const q = query.value.trim().toLowerCase()
  let items = allForCampaign.filter((e) => {
    if (!q) return true
    return (
      e.title.toLowerCase().includes(q) ||
      e.body.toLowerCase().includes(q) ||
      e.tags.some((t) => t.toLowerCase().includes(q))
    )
  })
  if (onlyTag.value) {
    items = items.filter((e) => e.tags.includes(onlyTag.value!))
  }
  if (onlyCategory.value) {
    items = items.filter((e) => e.category === onlyCategory.value)
  }
  return [...items].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
    return a.title.localeCompare(b.title)
  })
})

const tags = computed(() => {
  if (!campaign.value) return []
  const seen = new Set<string>()
  for (const entry of lore.forCampaign(campaign.value.id as CampaignId)) {
    for (const t of entry.tags) seen.add(t)
  }
  return [...seen].sort()
})

const draft = reactive<{
  title: string
  body: string
  category: (typeof LORE_CATEGORIES)[number]
  tags: string
  revealed: boolean
}>({
  title: '',
  body: '',
  category: 'misc',
  tags: '',
  revealed: false,
})

const lastError = ref<string | null>(null)

const crumbs = computed(() => [
  { to: '/', label: 'Home' },
  { to: '/campaigns', label: 'Campaigns' },
  {
    to: campaign.value ? `/campaigns/${campaign.value.id}` : '/campaigns',
    label: campaign.value?.name ?? 'Unknown',
  },
  { label: 'Lore' },
])

function resetDraft(): void {
  draft.title = ''
  draft.body = ''
  draft.category = 'misc'
  draft.tags = ''
  draft.revealed = false
  editingId.value = null
}

function startEdit(entry: LoreEntry): void {
  draft.title = entry.title
  draft.body = entry.body
  draft.category = entry.category
  draft.tags = entry.tags.join(', ')
  draft.revealed = entry.revealed
  editingId.value = entry.id
}

function saveDraft(): void {
  if (!campaign.value) return
  const payload: LoreDraftInput = {
    campaignId: campaign.value.id,
    title: draft.title,
    body: draft.body,
    category: draft.category,
    tags: draft.tags
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean),
    revealed: draft.revealed,
  }
  try {
    if (editingId.value) {
      lore.update(editingId.value, payload)
    } else {
      lore.create(payload)
    }
    resetDraft()
    lastError.value = null
  } catch (err) {
    lastError.value = err instanceof Error ? err.message : 'something went wrong'
  }
}

function deleteEntry(id: LoreId): void {
  if (!window.confirm('Delete this entry?')) return
  lore.remove(id)
  if (editingId.value === id) resetDraft()
}

function toggleReveal(entry: LoreEntry): void {
  lore.setRevealed(entry.id, !entry.revealed)
}

function togglePin(entry: LoreEntry): void {
  lore.setPinned(entry.id, !entry.pinned)
}
</script>

<template>
  <section class="container-wide py-8 space-y-6">
    <BreadcrumbTrail :crumbs="crumbs" />

    <div v-if="!campaign" class="surface p-8 text-center">
      <h2 class="text-xl font-display text-ink-900">Campaign not found</h2>
      <RouterLink to="/campaigns" class="link mt-3 inline-block">Back</RouterLink>
    </div>

    <template v-else>
      <PageHeader title="Lore" :meta="entries.length + ' entries'">
        <div class="flex gap-2 items-center">
          <select
            id="lore-category"
            v-model="onlyCategory"
            class="border border-parchment-300 rounded-soft px-2 py-1.5 text-sm bg-white"
          >
            <option value="">any category</option>
            <option v-for="c in LORE_CATEGORIES" :key="c" :value="c">{{ categoryLabel(c) }}</option>
          </select>
          <input
            v-model="query"
            type="text"
            placeholder="Search title, body, tags..."
            class="border border-parchment-300 rounded-soft px-3 py-1.5 text-sm bg-white"
          />
        </div>
      </PageHeader>

      <div v-if="tags.length > 0" class="flex flex-wrap gap-1 text-xs">
        <button
          type="button"
          class="px-2 py-1 rounded-full"
          :class="onlyTag === null ? 'bg-ink-700 text-white' : 'bg-parchment-100 text-ink-700 hover:bg-parchment-200'"
          @click="onlyTag = null"
        >
          all
        </button>
        <button
          v-for="t in tags"
          :key="t"
          type="button"
          class="px-2 py-1 rounded-full"
          :class="onlyTag === t ? 'bg-ink-700 text-white' : 'bg-parchment-100 text-ink-700 hover:bg-parchment-200'"
          @click="onlyTag = t"
        >
          #{{ t }}
        </button>
      </div>

      <SurfaceCard :title="editingId ? 'Edit entry' : 'New entry'">
        <form class="space-y-3" @submit.prevent="saveDraft">
          <input
            id="lore-title"
            v-model="draft.title"
            type="text"
            placeholder="Title"
            class="w-full border border-parchment-300 rounded-soft px-3 py-2 text-sm bg-white"
          />
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <select
              v-model="draft.category"
              class="border border-parchment-300 rounded-soft px-3 py-2 text-sm bg-white"
            >
              <option v-for="c in LORE_CATEGORIES" :key="c" :value="c">{{ categoryLabel(c) }}</option>
            </select>
            <input
              v-model="draft.tags"
              type="text"
              placeholder="Tags, comma-separated"
              class="border border-parchment-300 rounded-soft px-3 py-2 text-sm bg-white"
            />
          </div>
          <textarea
            v-model="draft.body"
            rows="5"
            placeholder="The body of the entry. Markdown-ish, plain text for now."
            class="w-full border border-parchment-300 rounded-soft px-3 py-2 text-sm bg-white"
          />
          <label class="flex items-center gap-2 text-sm text-ink-700">
            <input v-model="draft.revealed" type="checkbox" />
            Already revealed to the party
          </label>
          <p v-if="lastError" class="text-sm text-crimson-600">{{ lastError }}</p>
          <div class="flex items-center justify-end gap-2">
            <BaseButton v-if="editingId" tone="ghost" type="button" @click="resetDraft">Cancel</BaseButton>
            <BaseButton tone="primary" type="submit">{{ editingId ? 'Save' : 'Add entry' }}</BaseButton>
          </div>
        </form>
      </SurfaceCard>

      <EmptyState
        v-if="entries.length === 0"
        title="Nothing in the lore book yet"
        description="As the party uncovers history, add it here and mark it revealed."
      />
      <ul v-else class="space-y-3">
        <li v-for="entry in entries" :key="entry.id" class="surface p-3">
          <header class="flex items-start justify-between gap-2">
            <div class="min-w-0">
              <h3 class="text-base font-display text-ink-900">{{ entry.title }}</h3>
              <p class="text-xs text-ink-400">{{ categoryLabel(entry.category) }}</p>
            </div>
            <div class="flex gap-2 items-center">
              <StatusBadge v-if="entry.revealed" tone="success">Revealed</StatusBadge>
              <StatusBadge v-else tone="neutral">Hidden</StatusBadge>
              <StatusBadge v-if="entry.pinned" tone="warning">Pinned</StatusBadge>
            </div>
          </header>
          <div v-if="entry.body" class="mt-2">
            <MarkdownView :source="entry.body" empty="" />
          </div>
          <div v-if="entry.tags.length > 0" class="mt-2 flex flex-wrap gap-1 text-xs text-ink-500">
            <span v-for="t in entry.tags" :key="t" class="px-2 py-0.5 rounded-full bg-parchment-100">
              #{{ t }}
            </span>
          </div>
          <footer class="mt-3 flex flex-wrap gap-2">
            <button class="text-xs text-ink-700 hover:text-ink-900" @click="startEdit(entry)">edit</button>
            <button class="text-xs text-ink-700 hover:text-ink-900" @click="toggleReveal(entry)">
              {{ entry.revealed ? 'unreveal' : 'reveal' }}
            </button>
            <button class="text-xs text-ink-700 hover:text-ink-900" @click="togglePin(entry)">
              {{ entry.pinned ? 'unpin' : 'pin' }}
            </button>
            <button class="text-xs text-crimson-600 hover:text-crimson-800 ml-auto" @click="deleteEntry(entry.id)">
              delete
            </button>
          </footer>
        </li>
      </ul>
    </template>
  </section>
</template>
