<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { RouterLink, useRoute } from 'vue-router'

import type { CampaignId, RelationshipId } from '@core/ids'
import {
  RELATIONSHIP_KINDS,
  type RelationshipDraftInput,
  type RelationshipEndpoint,
  kindLabel,
} from '@core/models/relationship'

import { useCampaignStore } from '@features/campaigns/store'
import { useCharacterStore } from '@features/characters/store'
import { useFactionStore } from '@features/factions/store'
import { useRelationshipStore } from '../store'
import RelationshipGraph from '../components/RelationshipGraph.vue'

import BaseButton from '@ui/primitives/BaseButton.vue'
import BreadcrumbTrail from '@ui/primitives/BreadcrumbTrail.vue'
import EmptyState from '@ui/primitives/EmptyState.vue'
import PageHeader from '@ui/primitives/PageHeader.vue'
import StatusBadge from '@ui/primitives/StatusBadge.vue'
import SurfaceCard from '@ui/primitives/SurfaceCard.vue'

const route = useRoute()
const campaigns = useCampaignStore()
const characters = useCharacterStore()
const factions = useFactionStore()
const relationships = useRelationshipStore()

const campaignIdFromRoute = computed(() => route.params.campaignId as string)
const campaign = computed(() => campaigns.all.find((c) => c.id === campaignIdFromRoute.value))

const campChars = computed(() =>
  campaign.value ? characters.forCampaign(campaign.value.id as CampaignId) : [],
)
const campFactions = computed(() =>
  campaign.value ? factions.forCampaign(campaign.value.id as CampaignId) : [],
)
const edges = computed(() =>
  campaign.value ? relationships.forCampaign(campaign.value.id as CampaignId) : [],
)

interface EndpointPick {
  kind: 'character' | 'faction'
  id: string
}

const draft = reactive<{
  from: EndpointPick
  to: EndpointPick
  kind: (typeof RELATIONSHIP_KINDS)[number]
  intensity: number
  note: string
}>({
  from: { kind: 'character', id: '' },
  to: { kind: 'character', id: '' },
  kind: 'unknown',
  intensity: 3,
  note: '',
})

const lastError = ref<string | null>(null)

const crumbs = computed(() => [
  { to: '/', label: 'Home' },
  { to: '/campaigns', label: 'Campaigns' },
  {
    to: campaign.value ? `/campaigns/${campaign.value.id}` : '/campaigns',
    label: campaign.value?.name ?? 'Unknown',
  },
  { label: 'Bonds' },
])

function endpointName(ep: RelationshipEndpoint): string {
  if (ep.kind === 'character') {
    return campChars.value.find((c) => c.id === ep.id)?.name ?? 'unknown'
  }
  return campFactions.value.find((f) => f.id === ep.id)?.name ?? 'unknown'
}

function optionsFor(kind: 'character' | 'faction'): Array<{ id: string; label: string }> {
  if (kind === 'character') return campChars.value.map((c) => ({ id: c.id, label: c.name }))
  return campFactions.value.map((f) => ({ id: f.id, label: f.name }))
}

function addRelationship(): void {
  if (!campaign.value) return
  if (!draft.from.id || !draft.to.id) {
    lastError.value = 'pick a from and a to'
    return
  }
  const payload: RelationshipDraftInput = {
    campaignId: campaign.value.id,
    from: { kind: draft.from.kind, id: draft.from.id },
    to: { kind: draft.to.kind, id: draft.to.id },
    kind: draft.kind,
    intensity: Number(draft.intensity),
    note: draft.note,
  }
  try {
    relationships.create(payload)
    draft.note = ''
    lastError.value = null
  } catch (err) {
    lastError.value = err instanceof Error ? err.message : 'something went wrong'
  }
}

function deleteEdge(id: RelationshipId): void {
  if (!window.confirm('Delete this bond?')) return
  relationships.remove(id)
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
        title="Bonds"
        subtitle="Who knows who, who hates whom, who is whose mentor."
        :meta="edges.length + ' bonds'"
      />

      <SurfaceCard title="Graph">
        <RelationshipGraph
          :relationships="edges"
          :characters="campChars.map((c) => ({ id: c.id, name: c.name }))"
          :factions="campFactions.map((f) => ({ id: f.id, name: f.name }))"
        />
      </SurfaceCard>

      <SurfaceCard title="Add a bond">
        <form class="grid grid-cols-1 sm:grid-cols-2 gap-3" @submit.prevent="addRelationship">
          <div>
            <label class="block text-xs text-ink-500" for="rel-from-kind">From</label>
            <div class="flex gap-1">
              <select
                id="rel-from-kind"
                v-model="draft.from.kind"
                class="border border-parchment-300 rounded-soft px-2 py-1 text-sm bg-white"
              >
                <option value="character">Character</option>
                <option value="faction">Faction</option>
              </select>
              <select
                v-model="draft.from.id"
                class="flex-1 border border-parchment-300 rounded-soft px-2 py-1 text-sm bg-white"
              >
                <option value="">(pick one)</option>
                <option v-for="o in optionsFor(draft.from.kind)" :key="o.id" :value="o.id">{{ o.label }}</option>
              </select>
            </div>
          </div>
          <div>
            <label class="block text-xs text-ink-500" for="rel-to-kind">To</label>
            <div class="flex gap-1">
              <select
                id="rel-to-kind"
                v-model="draft.to.kind"
                class="border border-parchment-300 rounded-soft px-2 py-1 text-sm bg-white"
              >
                <option value="character">Character</option>
                <option value="faction">Faction</option>
              </select>
              <select
                v-model="draft.to.id"
                class="flex-1 border border-parchment-300 rounded-soft px-2 py-1 text-sm bg-white"
              >
                <option value="">(pick one)</option>
                <option v-for="o in optionsFor(draft.to.kind)" :key="o.id" :value="o.id">{{ o.label }}</option>
              </select>
            </div>
          </div>
          <div>
            <label class="block text-xs text-ink-500" for="rel-kind">Kind</label>
            <select
              id="rel-kind"
              v-model="draft.kind"
              class="w-full border border-parchment-300 rounded-soft px-2 py-1 text-sm bg-white"
            >
              <option v-for="k in RELATIONSHIP_KINDS" :key="k" :value="k">{{ kindLabel(k) }}</option>
            </select>
          </div>
          <div>
            <label class="block text-xs text-ink-500" for="rel-intensity">Intensity ({{ draft.intensity }})</label>
            <input
              id="rel-intensity"
              v-model.number="draft.intensity"
              type="range"
              min="1"
              max="5"
              class="w-full accent-crimson-500"
            />
          </div>
          <div class="sm:col-span-2">
            <label class="block text-xs text-ink-500" for="rel-note">Note</label>
            <input
              id="rel-note"
              v-model="draft.note"
              type="text"
              class="w-full border border-parchment-300 rounded-soft px-2 py-1 text-sm bg-white"
            />
          </div>
          <div class="sm:col-span-2 flex justify-end">
            <BaseButton tone="primary" type="submit">Add bond</BaseButton>
          </div>
        </form>
        <p v-if="lastError" class="mt-2 text-sm text-crimson-600">{{ lastError }}</p>
      </SurfaceCard>

      <SurfaceCard title="All bonds">
        <EmptyState
          v-if="edges.length === 0"
          title="No bonds yet"
          description="Add a connection above; the graph above will fill in as you go."
        />
        <ul v-else class="text-sm space-y-1">
          <li
            v-for="r in edges"
            :key="r.id"
            class="flex items-center gap-2 border-b border-parchment-200 py-1"
          >
            <StatusBadge tone="info">{{ kindLabel(r.kind) }}</StatusBadge>
            <span class="text-ink-700">{{ endpointName(r.from) }}</span>
            <span class="text-ink-400">to</span>
            <span class="text-ink-700">{{ endpointName(r.to) }}</span>
            <span class="text-xs text-ink-400 ml-auto">{{ r.intensity }}/5</span>
            <button
              type="button"
              class="text-xs text-crimson-600 hover:text-crimson-800"
              @click="deleteEdge(r.id)"
            >
              remove
            </button>
          </li>
        </ul>
      </SurfaceCard>
    </template>
  </section>
</template>
