<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { RouterLink, useRoute } from 'vue-router'

import type { CampaignId } from '@core/ids'
import {
  HANDOUT_KINDS,
  HANDOUT_VISIBILITIES,
  type Handout,
  type HandoutVisibility,
  kindLabel,
  recipientLine,
  visibilityLabel,
  visibilityTone,
} from '@core/models/handout'
import { relativeFromNow } from '@core/time/timestamps'

import { useCampaignStore } from '@features/campaigns/store'
import { useHandoutStore } from '../store'

import BaseButton from '@ui/primitives/BaseButton.vue'
import BreadcrumbTrail from '@ui/primitives/BreadcrumbTrail.vue'
import EmptyState from '@ui/primitives/EmptyState.vue'
import MarkdownView from '@ui/primitives/MarkdownView.vue'
import PageHeader from '@ui/primitives/PageHeader.vue'
import StatusBadge from '@ui/primitives/StatusBadge.vue'
import SurfaceCard from '@ui/primitives/SurfaceCard.vue'

const route = useRoute()
const campaigns = useCampaignStore()
const handouts = useHandoutStore()

const campaignIdFromRoute = computed(() => route.params.campaignId as string)
const campaign = computed(() => campaigns.all.find((c) => c.id === campaignIdFromRoute.value))

const filter = ref<HandoutVisibility | 'all'>('all')

const visible = computed<Handout[]>(() => {
  if (!campaign.value) return []
  const cid = campaign.value.id as CampaignId
  const list = filter.value === 'all'
    ? handouts.forCampaign(cid)
    : handouts.byVisibility(cid, filter.value)
  return [...list].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
})

const editingId = ref<string | null>(null)
const newRecipientFor = ref<Record<string, string>>({})

const draft = reactive<{
  title: string
  body: string
  kind: (typeof HANDOUT_KINDS)[number]
  visibility: HandoutVisibility
  signature: string
}>({
  title: '',
  body: '',
  kind: 'note',
  visibility: 'draft',
  signature: '',
})

const lastError = ref<string | null>(null)

const crumbs = computed(() => [
  { to: '/', label: 'Home' },
  { to: '/campaigns', label: 'Campaigns' },
  {
    to: campaign.value ? `/campaigns/${campaign.value.id}` : '/campaigns',
    label: campaign.value?.name ?? 'Unknown',
  },
  { label: 'Handouts' },
])

function resetDraft(): void {
  draft.title = ''
  draft.body = ''
  draft.kind = 'note'
  draft.visibility = 'draft'
  draft.signature = ''
  editingId.value = null
}

function startEdit(h: Handout): void {
  editingId.value = h.id
  draft.title = h.title
  draft.body = h.body
  draft.kind = h.kind
  draft.visibility = h.visibility
  draft.signature = h.signature
}

function save(): void {
  if (!campaign.value) return
  const payload = {
    campaignId: campaign.value.id,
    title: draft.title,
    body: draft.body,
    kind: draft.kind,
    visibility: draft.visibility,
    signature: draft.signature,
  }
  try {
    if (editingId.value) handouts.update(editingId.value, payload)
    else handouts.create(payload)
    resetDraft()
    lastError.value = null
  } catch (err) {
    lastError.value = err instanceof Error ? err.message : 'something went wrong'
  }
}

function toggleShare(h: Handout): void {
  if (h.visibility === 'shared') handouts.unshare(h.id)
  else handouts.share(h.id)
}

function archive(h: Handout): void {
  handouts.archive(h.id)
}

function addRecipient(h: Handout): void {
  const name = newRecipientFor.value[h.id]
  if (!name) return
  handouts.addRecipient(h.id, name)
  newRecipientFor.value[h.id] = ''
}

function removeRecipient(h: Handout, name: string): void {
  handouts.removeRecipient(h.id, name)
}

function deleteHandout(h: Handout): void {
  if (!window.confirm('Delete this handout?')) return
  if (editingId.value === h.id) resetDraft()
  handouts.remove(h.id)
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
      <PageHeader title="Player handouts" subtitle="Letters, maps and rumors you choose to put in players hands.">
        <select
          id="handout-filter"
          v-model="filter"
          class="border border-parchment-300 rounded-soft px-2 py-1 text-sm bg-white"
        >
          <option value="all">All</option>
          <option v-for="v in HANDOUT_VISIBILITIES" :key="v" :value="v">{{ visibilityLabel(v) }}</option>
        </select>
      </PageHeader>

      <SurfaceCard :title="editingId ? 'Edit handout' : 'New handout'">
        <form class="space-y-3" @submit.prevent="save">
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <input
              id="handout-title"
              v-model="draft.title"
              type="text"
              placeholder="Title"
              class="sm:col-span-2 border border-parchment-300 rounded-soft px-3 py-2 text-sm bg-white"
            />
            <select
              id="handout-kind"
              v-model="draft.kind"
              class="border border-parchment-300 rounded-soft px-3 py-2 text-sm bg-white"
            >
              <option v-for="k in HANDOUT_KINDS" :key="k" :value="k">{{ kindLabel(k) }}</option>
            </select>
            <input
              v-model="draft.signature"
              type="text"
              placeholder="Signature (e.g. Iris)"
              class="border border-parchment-300 rounded-soft px-3 py-2 text-sm bg-white"
            />
            <select
              id="handout-visibility"
              v-model="draft.visibility"
              class="sm:col-span-2 border border-parchment-300 rounded-soft px-3 py-2 text-sm bg-white"
            >
              <option v-for="v in HANDOUT_VISIBILITIES" :key="v" :value="v">{{ visibilityLabel(v) }}</option>
            </select>
          </div>
          <textarea
            v-model="draft.body"
            rows="6"
            placeholder="Markdown supported"
            class="w-full border border-parchment-300 rounded-soft px-3 py-2 text-sm bg-white"
          />
          <p v-if="lastError" class="text-sm text-crimson-600">{{ lastError }}</p>
          <div class="flex items-center justify-end gap-2">
            <BaseButton v-if="editingId" tone="ghost" type="button" @click="resetDraft">Cancel</BaseButton>
            <BaseButton tone="primary" type="submit">{{ editingId ? 'Update' : 'Add handout' }}</BaseButton>
          </div>
        </form>
      </SurfaceCard>

      <EmptyState
        v-if="visible.length === 0"
        title="No handouts here"
        description="Add a letter, map, or rumor to share with the table."
      />

      <ul v-else class="space-y-3">
        <li v-for="h in visible" :key="h.id" class="surface p-3">
          <header class="flex items-start justify-between gap-2">
            <div class="min-w-0">
              <h3 class="text-base font-display text-ink-900">{{ h.title }}</h3>
              <p class="text-xs text-ink-400">
                {{ kindLabel(h.kind) }} &middot; {{ recipientLine(h) }}<span v-if="h.sharedAt"> &middot; shared {{ relativeFromNow(h.sharedAt) }}</span>
              </p>
            </div>
            <StatusBadge :tone="visibilityTone(h.visibility)">{{ visibilityLabel(h.visibility) }}</StatusBadge>
          </header>
          <div class="mt-2">
            <MarkdownView :source="h.body" empty="" />
          </div>
          <p v-if="h.signature" class="mt-2 italic text-ink-600">{{ h.signature }}</p>

          <div class="mt-3 flex flex-wrap items-center gap-2 text-xs">
            <span
              v-for="r in h.recipients"
              :key="r"
              class="inline-flex items-center gap-1 bg-parchment-100 text-ink-700 rounded-full px-2 py-0.5"
            >
              {{ r }}
              <button type="button" class="text-crimson-600 hover:text-crimson-800" @click="removeRecipient(h, r)">
                ×
              </button>
            </span>
            <input
              :id="'handout-recipient-' + h.id"
              v-model="newRecipientFor[h.id]"
              type="text"
              placeholder="add recipient"
              class="border border-parchment-300 rounded-soft px-2 py-1 bg-white"
              @keyup.enter="addRecipient(h)"
            />
            <button class="text-ink-700 hover:text-ink-900" @click="addRecipient(h)">add</button>
          </div>

          <footer class="mt-3 flex flex-wrap gap-2 text-xs">
            <button class="text-ink-600 hover:text-ink-900" @click="startEdit(h)">edit</button>
            <button class="text-ink-600 hover:text-ink-900" @click="toggleShare(h)">
              {{ h.visibility === 'shared' ? 'unshare' : 'share' }}
            </button>
            <button class="text-ink-600 hover:text-ink-900" @click="archive(h)">archive</button>
            <button class="ml-auto text-crimson-600 hover:text-crimson-800" @click="deleteHandout(h)">
              delete
            </button>
          </footer>
        </li>
      </ul>
    </template>
  </section>
</template>
