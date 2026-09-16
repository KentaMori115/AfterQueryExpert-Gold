<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { useRoute } from 'vue-router'

import type { CampaignId, CharacterId } from '@core/ids'
import {
  DOWNTIME_KINDS,
  DOWNTIME_OUTCOMES,
  type DowntimeKind,
  type DowntimeOutcome,
  downtimeKindLabel,
  downtimeKindTone,
  downtimeOutcomeTone,
} from '@core/models/downtime'

import { useCampaignStore } from '@features/campaigns/store'
import { useCharacterStore } from '@features/characters/store'

import BaseButton from '@ui/primitives/BaseButton.vue'
import BreadcrumbTrail from '@ui/primitives/BreadcrumbTrail.vue'
import EmptyState from '@ui/primitives/EmptyState.vue'
import PageHeader from '@ui/primitives/PageHeader.vue'
import StatusBadge from '@ui/primitives/StatusBadge.vue'
import SurfaceCard from '@ui/primitives/SurfaceCard.vue'

import { useDowntimeStore } from '../store'

const route = useRoute()
const campaigns = useCampaignStore()
const characters = useCharacterStore()
const downtime = useDowntimeStore()

const campaignIdFromRoute = computed(() => route.params.campaignId as string)
const campaign = computed(() => campaigns.all.find((c) => c.id === campaignIdFromRoute.value))

const cast = computed(() =>
  campaign.value
    ? characters
        .forCampaign(campaign.value.id as CampaignId)
        .filter((c) => c.kind === 'pc' && c.alive)
    : [],
)

const activities = computed(() =>
  campaign.value ? downtime.forCampaign(campaign.value.id as CampaignId) : [],
)

const draft = reactive<{
  characterId: string | ''
  kind: DowntimeKind
  weeks: number
  description: string
  reward: string
}>({
  characterId: '',
  kind: 'crafting',
  weeks: 1,
  description: '',
  reward: '',
})

const lastError = ref<string | null>(null)

const crumbs = computed(() => [
  { to: '/', label: 'Home' },
  { to: '/campaigns', label: 'Campaigns' },
  {
    to: campaign.value ? `/campaigns/${campaign.value.id}` : '/campaigns',
    label: campaign.value?.name ?? 'Unknown',
  },
  { label: 'Downtime' },
])

function characterName(id: string): string {
  const c = characters.byId(id as CharacterId)
  return c?.name ?? 'Unknown'
}

function logActivity(): void {
  if (!campaign.value) return
  if (!draft.characterId) {
    lastError.value = 'pick a character first'
    return
  }
  try {
    downtime.create({
      campaignId: campaign.value.id as CampaignId,
      characterId: draft.characterId as CharacterId,
      kind: draft.kind,
      weeks: Number(draft.weeks),
      description: draft.description,
      reward: draft.reward,
    })
    draft.description = ''
    draft.reward = ''
    lastError.value = null
  } catch (err) {
    lastError.value = err instanceof Error ? err.message : 'log failed'
  }
}

function advance(id: string, outcome: DowntimeOutcome): void {
  downtime.setOutcome(id, outcome)
}

function deleteActivity(id: string): void {
  if (!window.confirm('Forget this downtime entry?')) return
  downtime.remove(id)
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
        title="Downtime"
        subtitle="What the cast does between scenes."
        :meta="activities.length + ' on the books'"
      />

      <SurfaceCard title="Log an activity">
        <form class="grid grid-cols-1 sm:grid-cols-4 gap-3" @submit.prevent="logActivity">
          <select
            v-model="draft.characterId"
            class="border border-parchment-300 rounded-soft px-3 py-2 text-sm bg-white sm:col-span-2"
          >
            <option value="">Character...</option>
            <option v-for="c in cast" :key="c.id" :value="c.id">{{ c.name }}</option>
          </select>
          <select
            v-model="draft.kind"
            class="border border-parchment-300 rounded-soft px-3 py-2 text-sm bg-white"
          >
            <option v-for="k in DOWNTIME_KINDS" :key="k" :value="k">
              {{ downtimeKindLabel(k) }}
            </option>
          </select>
          <input
            v-model.number="draft.weeks"
            type="number"
            min="0"
            max="520"
            placeholder="weeks"
            class="border border-parchment-300 rounded-soft px-3 py-2 text-sm bg-white"
          />
          <textarea
            v-model="draft.description"
            placeholder="What are they trying to do?"
            rows="2"
            class="sm:col-span-2 border border-parchment-300 rounded-soft px-3 py-2 text-sm bg-white"
          />
          <input
            v-model="draft.reward"
            type="text"
            placeholder="Reward if it works"
            class="sm:col-span-2 border border-parchment-300 rounded-soft px-3 py-2 text-sm bg-white"
          />
          <div class="sm:col-span-4 flex justify-end">
            <BaseButton tone="primary" type="submit">Log</BaseButton>
          </div>
        </form>
        <p v-if="lastError" class="mt-2 text-sm text-crimson-600">{{ lastError }}</p>
      </SurfaceCard>

      <EmptyState
        v-if="activities.length === 0"
        title="No downtime logged"
        description="Pick a character, choose what they are doing, and log it."
      />

      <ul v-else class="space-y-3">
        <li v-for="a in activities" :key="a.id" class="surface p-3 space-y-2">
          <header class="flex flex-wrap items-center gap-2">
            <span class="font-display text-ink-900">{{ characterName(a.characterId) }}</span>
            <StatusBadge :tone="downtimeKindTone(a.kind)">{{ downtimeKindLabel(a.kind) }}</StatusBadge>
            <StatusBadge :tone="downtimeOutcomeTone(a.outcome)">{{ a.outcome }}</StatusBadge>
            <span class="text-xs text-ink-500">{{ a.weeks }} weeks</span>
            <button
              type="button"
              class="ml-auto text-xs text-crimson-600 hover:text-crimson-800"
              @click="deleteActivity(a.id)"
            >
              forget
            </button>
          </header>
          <p v-if="a.description" class="text-sm text-ink-700">{{ a.description }}</p>
          <p v-if="a.reward" class="text-xs text-ink-500">
            <span class="uppercase tracking-wide">Reward: </span>{{ a.reward }}
          </p>
          <footer class="flex flex-wrap gap-2 text-xs">
            <button
              v-for="outcome in DOWNTIME_OUTCOMES"
              :key="outcome"
              type="button"
              class="px-2 py-1 rounded-soft"
              :class="
                a.outcome === outcome
                  ? 'bg-ink-700 text-white'
                  : 'bg-parchment-100 text-ink-700 hover:bg-parchment-200'
              "
              @click="advance(a.id, outcome)"
            >
              {{ outcome }}
            </button>
          </footer>
        </li>
      </ul>
    </template>
  </section>
</template>
