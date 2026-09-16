<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { useRoute } from 'vue-router'

import type { CampaignId } from '@core/ids'
import {
  COIN_KINDS,
  type CoinKind,
  type CoinPurse,
  coinLabel,
  emptyPurse,
  formatPurse,
  totalInGp,
} from '@core/rules/coin'
import { relativeFromNow } from '@core/time/timestamps'

import { useCampaignStore } from '@features/campaigns/store'
import { useCharacterStore } from '@features/characters/store'

import BaseButton from '@ui/primitives/BaseButton.vue'
import BreadcrumbTrail from '@ui/primitives/BreadcrumbTrail.vue'
import EmptyState from '@ui/primitives/EmptyState.vue'
import PageHeader from '@ui/primitives/PageHeader.vue'
import StatusBadge from '@ui/primitives/StatusBadge.vue'
import SurfaceCard from '@ui/primitives/SurfaceCard.vue'

import { useTreasuryStore } from '../store'

const route = useRoute()
const campaigns = useCampaignStore()
const characters = useCharacterStore()
const treasury = useTreasuryStore()

const campaignIdFromRoute = computed(() => route.params.campaignId as string)
const campaign = computed(() => campaigns.all.find((c) => c.id === campaignIdFromRoute.value))

const purse = computed<CoinPurse>(() =>
  campaign.value ? treasury.purseFor(campaign.value.id as CampaignId) : emptyPurse(),
)

const entries = computed(() =>
  campaign.value
    ? [...treasury.entriesFor(campaign.value.id as CampaignId)].reverse().slice(0, 20)
    : [],
)

const party = computed(() =>
  campaign.value
    ? characters
        .forCampaign(campaign.value.id as CampaignId)
        .filter((c) => c.kind === 'pc' && c.alive)
        .map((c) => c.name)
    : [],
)

const draft = reactive<CoinPurse>({ cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 })
const reason = ref('')
const direction = ref<'deposit' | 'withdraw'>('deposit')

const lastError = ref<string | null>(null)

function totalDraft(): number {
  return (
    draft.cp +
    draft.sp +
    draft.ep +
    draft.gp +
    draft.pp
  )
}

function applyDraft(): void {
  if (!campaign.value) return
  if (totalDraft() <= 0) {
    lastError.value = 'enter at least one coin'
    return
  }
  try {
    if (direction.value === 'deposit') {
      treasury.deposit(campaign.value.id as CampaignId, { ...draft }, reason.value, party.value)
    } else {
      treasury.withdraw(campaign.value.id as CampaignId, { ...draft }, reason.value, party.value)
    }
    draft.cp = 0
    draft.sp = 0
    draft.ep = 0
    draft.gp = 0
    draft.pp = 0
    reason.value = ''
    lastError.value = null
  } catch (err) {
    lastError.value = err instanceof Error ? err.message : 'failed'
  }
}

function consolidate(): void {
  if (campaign.value) treasury.consolidate(campaign.value.id as CampaignId)
}

function clearLog(): void {
  if (!campaign.value) return
  if (!window.confirm('Clear the treasury log? The purse stays put.')) return
  treasury.clearLog(campaign.value.id as CampaignId)
}

const crumbs = computed(() => [
  { to: '/', label: 'Home' },
  { to: '/campaigns', label: 'Campaigns' },
  {
    to: campaign.value ? `/campaigns/${campaign.value.id}` : '/campaigns',
    label: campaign.value?.name ?? 'Unknown',
  },
  { label: 'Treasury' },
])

const directionTones: Record<'deposit' | 'withdraw', 'success' | 'warning'> = {
  deposit: 'success',
  withdraw: 'warning',
}
</script>

<template>
  <section class="container-wide py-8 space-y-6 max-w-3xl">
    <BreadcrumbTrail :crumbs="crumbs" />

    <div v-if="!campaign" class="surface p-8 text-center">
      <h2 class="text-xl font-display text-ink-900">Campaign not found</h2>
    </div>

    <template v-else>
      <PageHeader
        title="Party treasury"
        subtitle="A shared pile, kept honest."
        :meta="totalInGp(purse) + ' gp on hand'"
      />

      <SurfaceCard title="Purse">
        <div class="flex flex-wrap items-center gap-3">
          <span class="font-display text-2xl text-ink-900">{{ totalInGp(purse) }} gp</span>
          <span class="text-sm text-ink-500">{{ formatPurse(purse) }}</span>
          <div class="ml-auto flex gap-2">
            <BaseButton size="sm" @click="consolidate">consolidate</BaseButton>
            <BaseButton size="sm" tone="danger" @click="clearLog">clear log</BaseButton>
          </div>
        </div>
        <div class="mt-3 grid grid-cols-5 gap-2 text-xs">
          <div
            v-for="kind in COIN_KINDS"
            :key="kind"
            class="surface p-2 flex flex-col items-center gap-1"
          >
            <span class="uppercase tracking-wide text-ink-500">{{ kind }}</span>
            <span class="font-mono text-base text-ink-900">{{ purse[kind] }}</span>
            <span class="text-ink-400">{{ coinLabel(kind) }}</span>
          </div>
        </div>
      </SurfaceCard>

      <SurfaceCard title="Move coin">
        <form class="grid grid-cols-2 sm:grid-cols-6 gap-2" @submit.prevent="applyDraft">
          <select
            id="direction"
            v-model="direction"
            class="sm:col-span-2 border border-parchment-300 rounded-soft px-2 py-1 text-sm bg-white"
          >
            <option value="deposit">deposit</option>
            <option value="withdraw">withdraw</option>
          </select>
          <input
            v-for="kind in COIN_KINDS"
            :key="kind"
            :id="'amount-' + kind"
            v-model.number="draft[kind as CoinKind]"
            type="number"
            min="0"
            :placeholder="kind"
            class="border border-parchment-300 rounded-soft px-2 py-1 text-sm bg-white text-right"
          />
          <input
            v-model="reason"
            type="text"
            placeholder="reason (loot from goblins)"
            class="sm:col-span-5 border border-parchment-300 rounded-soft px-2 py-1 text-sm bg-white"
          />
          <BaseButton tone="primary" size="sm" type="submit">log</BaseButton>
        </form>
        <p v-if="lastError" class="mt-2 text-sm text-crimson-600">{{ lastError }}</p>
      </SurfaceCard>

      <EmptyState
        v-if="entries.length === 0"
        title="No movements yet"
        description="Deposit the first hoard once the party finds one."
      />

      <SurfaceCard v-else title="Recent movements">
        <ul class="space-y-2 text-sm">
          <li v-for="entry in entries" :key="entry.id" class="flex flex-wrap items-center gap-2">
            <StatusBadge :tone="directionTones[entry.direction]">{{ entry.direction }}</StatusBadge>
            <span class="text-ink-700">{{ formatPurse(entry.purse) }}</span>
            <span class="text-ink-500">- {{ entry.reason || 'untold' }}</span>
            <span class="ml-auto text-xs text-ink-400">{{ relativeFromNow(entry.at) }}</span>
          </li>
        </ul>
      </SurfaceCard>
    </template>
  </section>
</template>
