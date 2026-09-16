<script setup lang="ts">
import { computed, ref } from 'vue'

import { relativeFromNow } from '@core/time/timestamps'

import BaseButton from '@ui/primitives/BaseButton.vue'
import BreadcrumbTrail from '@ui/primitives/BreadcrumbTrail.vue'
import EmptyState from '@ui/primitives/EmptyState.vue'
import PageHeader from '@ui/primitives/PageHeader.vue'
import StatusBadge from '@ui/primitives/StatusBadge.vue'
import SurfaceCard from '@ui/primitives/SurfaceCard.vue'

import { useRecycleStore, type RecycledEntry, type RecycleEntityKind } from '../store'

const store = useRecycleStore()
const kindFilter = ref<RecycleEntityKind | 'any'>('any')

const visible = computed<RecycledEntry[]>(() => {
  if (kindFilter.value === 'any') return store.entries
  return store.entries.filter((e) => e.kind === kindFilter.value)
})

const crumbs = computed(() => [
  { to: '/', label: 'Home' },
  { label: 'Recycle bin' },
])

const KIND_LABELS: Record<RecycleEntityKind, string> = {
  character: 'Character',
  faction: 'Faction',
  location: 'Place',
  session: 'Session',
  arc: 'Arc',
  encounter: 'Encounter',
  lore: 'Lore',
  item: 'Item',
  quest: 'Quest',
  note: 'Note',
}

function summariseEntry(entry: RecycledEntry): string {
  const payload = entry.payload as Record<string, unknown> | null
  if (!payload) return entry.kind
  if (typeof payload.name === 'string' && payload.name) return payload.name
  if (typeof payload.title === 'string' && payload.title) return payload.title
  return entry.kind
}

function purgeOne(entry: RecycledEntry): void {
  if (!window.confirm('Permanently forget this entry?')) return
  store.purge(entry.id)
}

function purgeAll(): void {
  if (!window.confirm('Empty the whole recycle bin?')) return
  store.purgeAll()
}

function purgeExpiredNow(): void {
  const removed = store.purgeExpired()
  if (removed === 0) {
    window.alert('Nothing expired yet.')
  } else {
    window.alert(`Purged ${removed} expired entries.`)
  }
}
</script>

<template>
  <section class="container-wide py-8 space-y-6 max-w-3xl">
    <BreadcrumbTrail :crumbs="crumbs" />
    <PageHeader
      title="Recycle bin"
      subtitle="Deleted entries linger here until they expire."
      :meta="store.total + ' entries waiting'"
    />

    <SurfaceCard>
      <div class="flex flex-wrap items-end gap-3 text-xs">
        <label class="text-ink-500">
          Filter by kind
          <select
            id="bin-kind"
            v-model="kindFilter"
            class="mt-1 border border-parchment-300 rounded-soft px-2 py-1 bg-white"
          >
            <option value="any">Any</option>
            <option v-for="(label, kind) in KIND_LABELS" :key="kind" :value="kind">
              {{ label }}
            </option>
          </select>
        </label>
        <label class="text-ink-500">
          Retention (days)
          <input
            id="bin-ttl"
            type="number"
            :value="store.ttlDays"
            min="1"
            max="365"
            class="mt-1 w-20 border border-parchment-300 rounded-soft px-2 py-1 bg-white"
            @change="store.setTtlDays(Number(($event.target as HTMLInputElement).value))"
          />
        </label>
        <BaseButton size="sm" @click="purgeExpiredNow">Purge expired</BaseButton>
        <BaseButton size="sm" tone="danger" @click="purgeAll">Empty bin</BaseButton>
      </div>
    </SurfaceCard>

    <EmptyState
      v-if="visible.length === 0"
      title="Nothing here"
      description="When you delete something, it lands here so you can undo accidents."
    />

    <ul v-else class="space-y-3">
      <li v-for="entry in visible" :key="entry.id" class="surface p-3">
        <header class="flex items-start justify-between gap-3">
          <div>
            <h3 class="text-sm font-display text-ink-900">{{ summariseEntry(entry) }}</h3>
            <p class="text-xs text-ink-500">
              {{ KIND_LABELS[entry.kind] }} &middot; deleted {{ relativeFromNow(entry.deletedAt) }} &middot;
              expires {{ relativeFromNow(entry.expiresAt) }}
            </p>
          </div>
          <StatusBadge tone="neutral">{{ entry.kind }}</StatusBadge>
        </header>
        <footer class="mt-2 flex justify-end gap-2 text-xs">
          <button
            class="text-crimson-600 hover:text-crimson-800"
            @click="purgeOne(entry)"
          >
            forget forever
          </button>
        </footer>
      </li>
    </ul>
  </section>
</template>
