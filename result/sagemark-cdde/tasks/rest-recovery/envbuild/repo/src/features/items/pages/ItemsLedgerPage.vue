<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { RouterLink, useRoute } from 'vue-router'

import type { CampaignId, CharacterId, ItemId } from '@core/ids'
import {
  ITEM_KINDS,
  ITEM_RARITIES,
  type Item,
  type ItemDraftInput,
  formatGold,
  kindLabel,
  rarityLabel,
  rarityTone,
} from '@core/models/item'

import { useCampaignStore } from '@features/campaigns/store'
import { useCharacterStore } from '@features/characters/store'
import { useItemStore } from '../store'

import BaseButton from '@ui/primitives/BaseButton.vue'
import BreadcrumbTrail from '@ui/primitives/BreadcrumbTrail.vue'
import EmptyState from '@ui/primitives/EmptyState.vue'
import PageHeader from '@ui/primitives/PageHeader.vue'
import StatusBadge from '@ui/primitives/StatusBadge.vue'
import SurfaceCard from '@ui/primitives/SurfaceCard.vue'

const route = useRoute()
const campaigns = useCampaignStore()
const characters = useCharacterStore()
const items = useItemStore()

const campaignIdFromRoute = computed(() => route.params.campaignId as string)
const campaign = computed(() => campaigns.all.find((c) => c.id === campaignIdFromRoute.value))

const partyChars = computed(() =>
  campaign.value
    ? characters.forCampaign(campaign.value.id as CampaignId).filter((c) => c.kind === 'pc')
    : [],
)

const rarityFilter = ref<(typeof ITEM_RARITIES)[number] | 'any'>('any')
const sortMode = ref<'name' | 'rarity' | 'value'>('name')

const all = computed<Item[]>(() => {
  if (!campaign.value) return []
  const base = items.forCampaign(campaign.value.id as CampaignId)
  const filtered = rarityFilter.value === 'any' ? base : base.filter((i) => i.rarity === rarityFilter.value)
  const sorted = [...filtered]
  const rarityOrder = ITEM_RARITIES.reduce<Record<string, number>>((acc, r, idx) => {
    acc[r] = idx
    return acc
  }, {})
  if (sortMode.value === 'name') sorted.sort((a, b) => a.name.localeCompare(b.name))
  else if (sortMode.value === 'rarity') sorted.sort((a, b) => (rarityOrder[a.rarity] ?? 0) - (rarityOrder[b.rarity] ?? 0))
  else sorted.sort((a, b) => b.valueGp - a.valueGp)
  return sorted
})
const unowned = computed(() => all.value.filter((i) => i.ownerId === null))
const owned = computed(() => all.value.filter((i) => i.ownerId !== null))

const totalValue = computed(() =>
  campaign.value ? items.totalValueFor(campaign.value.id as CampaignId) : 0,
)

const draft = reactive<{
  name: string
  kind: (typeof ITEM_KINDS)[number]
  rarity: (typeof ITEM_RARITIES)[number]
  magical: boolean
  valueGp: number
  description: string
}>({
  name: '',
  kind: 'misc',
  rarity: 'common',
  magical: false,
  valueGp: 0,
  description: '',
})

const lastError = ref<string | null>(null)

const crumbs = computed(() => [
  { to: '/', label: 'Home' },
  { to: '/campaigns', label: 'Campaigns' },
  {
    to: campaign.value ? `/campaigns/${campaign.value.id}` : '/campaigns',
    label: campaign.value?.name ?? 'Unknown',
  },
  { label: 'Loot' },
])

function nameOfOwner(ownerId: CharacterId | null): string {
  if (!ownerId) return 'unclaimed'
  return partyChars.value.find((c) => c.id === ownerId)?.name ?? 'unknown'
}

function addItem(): void {
  if (!campaign.value) return
  const payload: ItemDraftInput = {
    campaignId: campaign.value.id,
    name: draft.name,
    kind: draft.kind,
    rarity: draft.rarity,
    magical: draft.magical,
    valueGp: Number(draft.valueGp) || 0,
    description: draft.description,
  }
  try {
    items.create(payload)
    draft.name = ''
    draft.description = ''
    draft.valueGp = 0
    draft.magical = false
    lastError.value = null
  } catch (err) {
    lastError.value = err instanceof Error ? err.message : 'something went wrong'
  }
}

function changeOwner(id: ItemId, ownerId: CharacterId | null): void {
  items.giveTo(id, ownerId)
}

function toggleAttuned(item: Item): void {
  try {
    items.setAttuned(item.id, !item.attuned)
    lastError.value = null
  } catch (err) {
    lastError.value = err instanceof Error ? err.message : 'something went wrong'
  }
}

function deleteItem(id: ItemId): void {
  if (!window.confirm('Remove this item from the ledger?')) return
  items.remove(id)
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
        title="Loot ledger"
        :meta="all.length + ' items / ' + formatGold(totalValue)"
      />

      <SurfaceCard title="Filter and sort">
        <div class="flex flex-wrap items-end gap-3 text-xs">
          <label class="text-ink-500">
            Rarity
            <select
              id="rarity-filter"
              v-model="rarityFilter"
              class="mt-1 border border-parchment-300 rounded-soft px-2 py-1 bg-white"
            >
              <option value="any">any</option>
              <option v-for="r in ITEM_RARITIES" :key="r" :value="r">{{ rarityLabel(r) }}</option>
            </select>
          </label>
          <label class="text-ink-500">
            Sort by
            <select
              id="sort-mode"
              v-model="sortMode"
              class="mt-1 border border-parchment-300 rounded-soft px-2 py-1 bg-white"
            >
              <option value="name">name</option>
              <option value="rarity">rarity</option>
              <option value="value">value</option>
            </select>
          </label>
        </div>
      </SurfaceCard>

      <SurfaceCard title="Add an item">
        <form class="grid grid-cols-1 sm:grid-cols-3 gap-3" @submit.prevent="addItem">
          <input
            id="item-name"
            v-model="draft.name"
            type="text"
            placeholder="Name"
            class="sm:col-span-2 border border-parchment-300 rounded-soft px-3 py-2 text-sm bg-white"
          />
          <input
            v-model.number="draft.valueGp"
            type="number"
            min="0"
            placeholder="Value in gp"
            class="border border-parchment-300 rounded-soft px-3 py-2 text-sm bg-white"
          />
          <select v-model="draft.kind" class="border border-parchment-300 rounded-soft px-3 py-2 text-sm bg-white">
            <option v-for="k in ITEM_KINDS" :key="k" :value="k">{{ kindLabel(k) }}</option>
          </select>
          <select v-model="draft.rarity" class="border border-parchment-300 rounded-soft px-3 py-2 text-sm bg-white">
            <option v-for="r in ITEM_RARITIES" :key="r" :value="r">{{ rarityLabel(r) }}</option>
          </select>
          <label class="flex items-center gap-2 text-sm text-ink-700">
            <input v-model="draft.magical" type="checkbox" />
            Magical
          </label>
          <textarea
            v-model="draft.description"
            rows="2"
            placeholder="Description"
            class="sm:col-span-3 border border-parchment-300 rounded-soft px-3 py-2 text-sm bg-white"
          />
          <div class="sm:col-span-3 flex justify-end">
            <BaseButton tone="primary" type="submit">Add to ledger</BaseButton>
          </div>
        </form>
        <p v-if="lastError" class="mt-2 text-sm text-crimson-600">{{ lastError }}</p>
      </SurfaceCard>

      <EmptyState
        v-if="all.length === 0"
        title="Empty pockets"
        description="Track what the party has found, claimed, and forgotten about."
      />

      <SurfaceCard v-if="unowned.length > 0" title="Unclaimed">
        <ul class="space-y-2 text-sm">
          <li v-for="i in unowned" :key="i.id" class="flex items-center gap-2 border-b border-parchment-200 pb-2">
            <span class="flex-1 text-ink-800">{{ i.name }}</span>
            <span class="text-xs text-ink-400">{{ kindLabel(i.kind) }}</span>
            <StatusBadge :tone="rarityTone(i.rarity)">{{ rarityLabel(i.rarity) }}</StatusBadge>
            <span class="text-xs text-ink-500">{{ formatGold(i.valueGp) }}</span>
            <select
              :value="i.ownerId ?? ''"
              class="border border-parchment-300 rounded-soft px-2 py-1 text-xs bg-white"
              @change="changeOwner(i.id, ($event.target as HTMLSelectElement).value ? (($event.target as HTMLSelectElement).value as CharacterId) : null)"
            >
              <option value="">unclaimed</option>
              <option v-for="c in partyChars" :key="c.id" :value="c.id">{{ c.name }}</option>
            </select>
            <button class="text-xs text-crimson-600 hover:text-crimson-800" @click="deleteItem(i.id)">remove</button>
          </li>
        </ul>
      </SurfaceCard>

      <SurfaceCard v-if="owned.length > 0" title="In someone's hands">
        <ul class="space-y-2 text-sm">
          <li v-for="i in owned" :key="i.id" class="flex items-center gap-2 border-b border-parchment-200 pb-2">
            <span class="flex-1 text-ink-800">{{ i.name }}</span>
            <span class="text-xs text-ink-400">to {{ nameOfOwner(i.ownerId) }}</span>
            <StatusBadge :tone="rarityTone(i.rarity)">{{ rarityLabel(i.rarity) }}</StatusBadge>
            <StatusBadge v-if="i.magical" tone="accent">Magical</StatusBadge>
            <StatusBadge v-if="i.attuned" tone="warning">Attuned</StatusBadge>
            <button v-if="i.magical" class="text-xs text-ink-700 hover:text-ink-900" @click="toggleAttuned(i)">
              {{ i.attuned ? 'unattune' : 'attune' }}
            </button>
            <button class="text-xs text-ink-700 hover:text-ink-900" @click="changeOwner(i.id, null)">
              unclaim
            </button>
            <button class="text-xs text-crimson-600 hover:text-crimson-800" @click="deleteItem(i.id)">remove</button>
          </li>
        </ul>
      </SurfaceCard>
    </template>
  </section>
</template>
