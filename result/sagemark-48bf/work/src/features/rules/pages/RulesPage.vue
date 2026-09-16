<script setup lang="ts">
import { computed, reactive, ref } from 'vue'

import {
  RULE_SCOPES,
  type RuleScope,
  ruleScopeLabel,
  ruleScopeTone,
} from '@core/models/rule-snippet'

import BaseButton from '@ui/primitives/BaseButton.vue'
import BreadcrumbTrail from '@ui/primitives/BreadcrumbTrail.vue'
import EmptyState from '@ui/primitives/EmptyState.vue'
import PageHeader from '@ui/primitives/PageHeader.vue'
import StatusBadge from '@ui/primitives/StatusBadge.vue'
import SurfaceCard from '@ui/primitives/SurfaceCard.vue'

import { useRuleSnippetStore } from '../store'

const store = useRuleSnippetStore()

const filterScope = ref<RuleScope | 'all'>('all')

const filtered = computed(() => {
  if (filterScope.value === 'all') return store.all
  return store.forScope(filterScope.value)
})

const draft = reactive<{
  title: string
  scope: RuleScope
  body: string
  source: string
  pinned: boolean
}>({
  title: '',
  scope: 'combat',
  body: '',
  source: '',
  pinned: false,
})

const lastError = ref<string | null>(null)

function add(): void {
  try {
    store.create({ ...draft })
    draft.title = ''
    draft.body = ''
    draft.source = ''
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
  if (!window.confirm('Forget this rule snippet?')) return
  store.remove(id)
}

const crumbs = [
  { to: '/', label: 'Home' },
  { label: 'Rules' },
]
</script>

<template>
  <section class="container-wide py-8 space-y-6 max-w-3xl">
    <BreadcrumbTrail :crumbs="crumbs" />
    <PageHeader
      title="Rule snippets"
      subtitle="Index cards you can pin to the top of the table."
      :meta="store.all.length + ' on hand'"
    />

    <SurfaceCard title="Filter">
      <div class="flex flex-wrap gap-2 text-xs">
        <button
          type="button"
          class="px-2 py-1 rounded-soft"
          :class="filterScope === 'all' ? 'bg-ink-700 text-white' : 'bg-parchment-100 text-ink-700'"
          @click="filterScope = 'all'"
        >
          all
        </button>
        <button
          v-for="scope in RULE_SCOPES"
          :key="scope"
          type="button"
          class="px-2 py-1 rounded-soft"
          :class="
            filterScope === scope
              ? 'bg-ink-700 text-white'
              : 'bg-parchment-100 hover:bg-parchment-200 text-ink-700'
          "
          @click="filterScope = scope"
        >
          {{ ruleScopeLabel(scope) }}
        </button>
      </div>
    </SurfaceCard>

    <SurfaceCard title="Add a snippet">
      <form class="grid grid-cols-2 sm:grid-cols-4 gap-2" @submit.prevent="add">
        <input
          id="rs-title"
          v-model="draft.title"
          type="text"
          placeholder="Title"
          class="sm:col-span-2 border border-parchment-300 rounded-soft px-2 py-1 text-sm bg-white"
        />
        <select
          v-model="draft.scope"
          class="border border-parchment-300 rounded-soft px-2 py-1 text-sm bg-white"
        >
          <option v-for="s in RULE_SCOPES" :key="s" :value="s">{{ ruleScopeLabel(s) }}</option>
        </select>
        <input
          v-model="draft.source"
          type="text"
          placeholder="source (optional)"
          class="border border-parchment-300 rounded-soft px-2 py-1 text-sm bg-white"
        />
        <textarea
          v-model="draft.body"
          rows="3"
          placeholder="The wording you keep forgetting at the table..."
          class="sm:col-span-4 border border-parchment-300 rounded-soft px-2 py-1 text-sm bg-white"
        />
        <label class="sm:col-span-2 flex items-center gap-2 text-xs">
          <input v-model="draft.pinned" type="checkbox" /> pin to top
        </label>
        <div class="sm:col-span-2 flex justify-end">
          <BaseButton tone="primary" size="sm" type="submit">add</BaseButton>
        </div>
      </form>
      <p v-if="lastError" class="mt-2 text-sm text-crimson-600">{{ lastError }}</p>
    </SurfaceCard>

    <EmptyState
      v-if="filtered.length === 0"
      title="No snippets here"
      description="Pin the rulings you keep looking up."
    />
    <ul v-else class="space-y-3">
      <li v-for="snippet in filtered" :key="snippet.id" class="surface p-3 space-y-1">
        <header class="flex flex-wrap items-center gap-2">
          <span class="font-display text-ink-900">{{ snippet.title }}</span>
          <StatusBadge :tone="ruleScopeTone(snippet.scope)">{{ ruleScopeLabel(snippet.scope) }}</StatusBadge>
          <StatusBadge v-if="snippet.pinned" tone="warning">pinned</StatusBadge>
          <span v-if="snippet.source" class="text-xs text-ink-500">{{ snippet.source }}</span>
          <span class="ml-auto flex gap-2 text-xs">
            <button class="text-ink-600 hover:text-ink-900" @click="togglePin(snippet.id)">
              {{ snippet.pinned ? 'unpin' : 'pin' }}
            </button>
            <button class="text-crimson-600 hover:text-crimson-800" @click="remove(snippet.id)">
              forget
            </button>
          </span>
        </header>
        <p class="text-sm text-ink-700 whitespace-pre-line">{{ snippet.body }}</p>
      </li>
    </ul>
  </section>
</template>
