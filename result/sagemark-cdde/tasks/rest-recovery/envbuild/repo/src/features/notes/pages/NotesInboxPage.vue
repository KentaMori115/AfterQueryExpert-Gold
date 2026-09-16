<script setup lang="ts">
import { computed, ref } from 'vue'
import { RouterLink, useRoute } from 'vue-router'

import type { CampaignId } from '@core/ids'
import {
  NOTE_PRIORITIES,
  NOTE_TARGET_KINDS,
  type Note,
  type NoteTargetKind,
  compareNotesForListing,
  isOverdue,
  priorityLabel,
  priorityTone,
  targetLabel,
} from '@core/models/note'
import { relativeFromNow } from '@core/time/timestamps'

import { useCampaignStore } from '@features/campaigns/store'
import { useCharacterStore } from '@features/characters/store'
import { useFactionStore } from '@features/factions/store'
import { useLocationStore } from '@features/locations/store'
import { useSessionStore } from '@features/sessions/store'
import { useArcStore } from '@features/arcs/store'
import { useLoreStore } from '@features/lore/store'
import { useQuestStore } from '@features/quests/store'
import { useItemStore } from '@features/items/store'
import { useEncounterStore } from '@features/encounters/store'

import { useNoteStore } from '../store'

import BreadcrumbTrail from '@ui/primitives/BreadcrumbTrail.vue'
import EmptyState from '@ui/primitives/EmptyState.vue'
import PageHeader from '@ui/primitives/PageHeader.vue'
import StatusBadge from '@ui/primitives/StatusBadge.vue'
import SurfaceCard from '@ui/primitives/SurfaceCard.vue'

type FilterMode = 'all' | 'open' | 'overdue' | 'resolved'

const route = useRoute()
const campaigns = useCampaignStore()
const notes = useNoteStore()

const characters = useCharacterStore()
const factions = useFactionStore()
const locations = useLocationStore()
const sessions = useSessionStore()
const arcs = useArcStore()
const lore = useLoreStore()
const quests = useQuestStore()
const items = useItemStore()
const encounters = useEncounterStore()

const campaignIdFromRoute = computed(() => route.params.campaignId as string)
const campaign = computed(() => campaigns.all.find((c) => c.id === campaignIdFromRoute.value))

const filter = ref<FilterMode>('open')
const kindFilter = ref<NoteTargetKind | 'any'>('any')
const query = ref('')

const visibleNotes = computed<Note[]>(() => {
  if (!campaign.value) return []
  const cid = campaign.value.id as CampaignId
  let list = notes.forCampaign(cid)
  if (filter.value === 'open') list = list.filter((n) => n.resolvedAt === null)
  else if (filter.value === 'resolved') list = list.filter((n) => n.resolvedAt !== null)
  else if (filter.value === 'overdue') list = list.filter((n) => isOverdue(n))
  if (kindFilter.value !== 'any') {
    list = list.filter((n) => n.target.kind === kindFilter.value)
  }
  const q = query.value.trim().toLowerCase()
  if (q) {
    list = list.filter(
      (n) => n.title.toLowerCase().includes(q) || n.body.toLowerCase().includes(q),
    )
  }
  return [...list].sort(compareNotesForListing)
})

const counts = computed(() => {
  if (!campaign.value) return { open: 0, overdue: 0, resolved: 0, total: 0 }
  const cid = campaign.value.id as CampaignId
  const all = notes.forCampaign(cid)
  return {
    open: all.filter((n) => n.resolvedAt === null).length,
    overdue: all.filter((n) => isOverdue(n)).length,
    resolved: all.filter((n) => n.resolvedAt !== null).length,
    total: all.length,
  }
})

const crumbs = computed(() => [
  { to: '/', label: 'Home' },
  { to: '/campaigns', label: 'Campaigns' },
  {
    to: campaign.value ? `/campaigns/${campaign.value.id}` : '/campaigns',
    label: campaign.value?.name ?? 'Unknown',
  },
  { label: 'Notes' },
])

function describeTarget(note: Note): { label: string; routeTo: string } {
  if (!campaign.value) return { label: 'Unknown', routeTo: '/campaigns' }
  const cid = campaign.value.id
  switch (note.target.kind) {
    case 'character': {
      const ch = characters.byId(note.target.id as never)
      return {
        label: ch?.name ?? 'Unknown character',
        routeTo: `/campaigns/${cid}/characters/${note.target.id}`,
      }
    }
    case 'faction': {
      const f = factions.byId(note.target.id as never)
      return {
        label: f?.name ?? 'Unknown faction',
        routeTo: `/campaigns/${cid}/factions/${note.target.id}`,
      }
    }
    case 'location': {
      const l = locations.byId(note.target.id as never)
      return {
        label: l?.name ?? 'Unknown place',
        routeTo: `/campaigns/${cid}/locations/${note.target.id}`,
      }
    }
    case 'session': {
      const s = sessions.byId(note.target.id as never)
      return {
        label: s ? `Session ${s.number}` : 'Unknown session',
        routeTo: `/campaigns/${cid}/sessions/${note.target.id}`,
      }
    }
    case 'arc': {
      const a = arcs.byId(note.target.id as never)
      return {
        label: a?.title ?? 'Unknown arc',
        routeTo: `/campaigns/${cid}/arcs/${note.target.id}`,
      }
    }
    case 'encounter': {
      const e = encounters.byId(note.target.id as never)
      return {
        label: e?.title ?? 'Unknown encounter',
        routeTo: `/campaigns/${cid}/encounters/${note.target.id}`,
      }
    }
    case 'lore': {
      const l = lore.byId(note.target.id as never)
      return {
        label: l?.title ?? 'Unknown lore',
        routeTo: `/campaigns/${cid}/lore`,
      }
    }
    case 'item': {
      const it = items.byId(note.target.id as never)
      return {
        label: it?.name ?? 'Unknown item',
        routeTo: `/campaigns/${cid}/items`,
      }
    }
    case 'quest': {
      const q = quests.byId(note.target.id as never)
      return {
        label: q?.title ?? 'Unknown quest',
        routeTo: `/campaigns/${cid}/quests`,
      }
    }
    case 'campaign':
      return { label: campaign.value?.name ?? 'Campaign', routeTo: `/campaigns/${cid}` }
  }
}

function toggleResolved(note: Note): void {
  if (note.resolvedAt) notes.reopen(note.id)
  else notes.resolve(note.id)
}

function togglePinned(note: Note): void {
  notes.setPinned(note.id, !note.pinned)
}

function bumpPriority(note: Note): void {
  const idx = NOTE_PRIORITIES.indexOf(note.priority)
  const next = NOTE_PRIORITIES[(idx + 1) % NOTE_PRIORITIES.length]
  notes.setPriority(note.id, next)
}

function removeNote(note: Note): void {
  if (!window.confirm('Delete this note?')) return
  notes.remove(note.id)
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
      <PageHeader
        title="Notes inbox"
        subtitle="The full pile of reminders, broken out by status and target."
        :meta="counts.open + ' open, ' + counts.overdue + ' overdue, ' + counts.resolved + ' done'"
      />

      <SurfaceCard>
        <div class="flex flex-wrap items-end gap-3 text-xs">
          <label class="text-ink-500">
            Filter
            <select
              v-model="filter"
              class="mt-1 border border-parchment-300 rounded-soft px-2 py-1 text-sm bg-white"
            >
              <option value="open">Open</option>
              <option value="overdue">Overdue</option>
              <option value="resolved">Resolved</option>
              <option value="all">All</option>
            </select>
          </label>
          <label class="text-ink-500">
            Target kind
            <select
              v-model="kindFilter"
              class="mt-1 border border-parchment-300 rounded-soft px-2 py-1 text-sm bg-white"
            >
              <option value="any">Any</option>
              <option v-for="k in NOTE_TARGET_KINDS" :key="k" :value="k">{{ targetLabel(k) }}</option>
            </select>
          </label>
          <label class="text-ink-500 flex-1 min-w-[200px]">
            Search
            <input
              v-model="query"
              type="search"
              placeholder="title or body fragment"
              class="mt-1 w-full border border-parchment-300 rounded-soft px-2 py-1 text-sm bg-white"
            />
          </label>
        </div>
      </SurfaceCard>

      <EmptyState
        v-if="visibleNotes.length === 0"
        title="Nothing to show"
        description="Try a wider filter; notes you create from any detail page will land here."
      />

      <ul v-else class="space-y-3">
        <li
          v-for="note in visibleNotes"
          :key="note.id"
          class="surface p-3"
          :class="note.resolvedAt ? 'opacity-60' : ''"
        >
          <header class="flex items-start justify-between gap-2">
            <div class="min-w-0">
              <h3 v-if="note.title" class="text-sm font-display text-ink-900">{{ note.title }}</h3>
              <p class="text-xs text-ink-400">
                {{ targetLabel(note.target.kind) }} ::
                <RouterLink :to="describeTarget(note).routeTo" class="link">
                  {{ describeTarget(note).label }}
                </RouterLink>
                &middot; updated {{ relativeFromNow(note.updatedAt) }}
              </p>
            </div>
            <div class="flex flex-wrap gap-2 items-center">
              <StatusBadge :tone="priorityTone(note.priority)">{{ priorityLabel(note.priority) }}</StatusBadge>
              <StatusBadge v-if="note.resolvedAt" tone="neutral">Done</StatusBadge>
              <StatusBadge v-else-if="isOverdue(note)" tone="danger">Overdue</StatusBadge>
              <StatusBadge v-if="note.pinned" tone="warning">Pinned</StatusBadge>
            </div>
          </header>
          <p class="mt-2 text-sm text-ink-700 whitespace-pre-line">{{ note.body }}</p>
          <footer class="mt-2 flex flex-wrap gap-2 text-xs">
            <button class="text-ink-600 hover:text-ink-900" @click="bumpPriority(note)">cycle priority</button>
            <button class="text-ink-600 hover:text-ink-900" @click="togglePinned(note)">
              {{ note.pinned ? 'unpin' : 'pin' }}
            </button>
            <button class="text-ink-600 hover:text-ink-900" @click="toggleResolved(note)">
              {{ note.resolvedAt ? 'reopen' : 'mark done' }}
            </button>
            <button class="ml-auto text-crimson-600 hover:text-crimson-800" @click="removeNote(note)">
              delete
            </button>
          </footer>
        </li>
      </ul>
    </template>
  </section>
</template>
