<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'

import type { CampaignId, EncounterId } from '@core/ids'
import {
  difficultyLabel,
  difficultyTone,
  kindLabel,
  type InitiativeEntry,
} from '@core/models/encounter'

import { useCampaignStore } from '@features/campaigns/store'
import { useEncounterStore } from '../store'
import InitiativeTracker from '../components/InitiativeTracker.vue'
import InitiativeRunnerPanel from '@features/initiative/components/InitiativeRunnerPanel.vue'
import DifficultyCalculator from '../components/DifficultyCalculator.vue'
import LightTrackerPanel from '@features/light/components/LightTrackerPanel.vue'
import TagPicker from '@features/tags/components/TagPicker.vue'

import BaseButton from '@ui/primitives/BaseButton.vue'
import BreadcrumbTrail from '@ui/primitives/BreadcrumbTrail.vue'
import PageHeader from '@ui/primitives/PageHeader.vue'
import StatusBadge from '@ui/primitives/StatusBadge.vue'
import SurfaceCard from '@ui/primitives/SurfaceCard.vue'

const route = useRoute()
const router = useRouter()
const campaigns = useCampaignStore()
const encounters = useEncounterStore()

const campaignIdFromRoute = computed(() => route.params.campaignId as string)
const encIdFromRoute = computed(() => route.params.id as string)

const campaign = computed(() => campaigns.all.find((c) => c.id === campaignIdFromRoute.value))
const encounter = computed(() => encounters.byId(encIdFromRoute.value as EncounterId))

const initiative = computed<InitiativeEntry[]>(() =>
  encounter.value ? [...encounter.value.initiative] : [],
)

const crumbs = computed(() => [
  { to: '/', label: 'Home' },
  { to: '/campaigns', label: 'Campaigns' },
  { to: campaign.value ? `/campaigns/${campaign.value.id}` : '/campaigns', label: campaign.value?.name ?? 'Unknown' },
  { to: campaign.value ? `/campaigns/${campaign.value.id}/encounters` : '/campaigns', label: 'Encounters' },
  { label: encounter.value?.title ?? 'Not found' },
])

function onUpdateInitiative(next: InitiativeEntry[]): void {
  if (!encounter.value) return
  encounters.setInitiative(encounter.value.id as EncounterId, next)
}

function toggleResolved(): void {
  if (!encounter.value) return
  encounters.markResolved(encounter.value.id as EncounterId, !encounter.value.resolved)
}

function deleteEncounter(): void {
  const e = encounter.value
  if (!e || !campaign.value) return
  if (!window.confirm(`Delete "${e.title}"?`)) return
  encounters.remove(e.id as EncounterId)
  router.push(`/campaigns/${campaign.value.id}/encounters`)
}
</script>

<template>
  <section class="container-wide py-8 space-y-6">
    <BreadcrumbTrail :crumbs="crumbs" />

    <div v-if="!campaign || !encounter" class="surface p-8 text-center">
      <h2 class="text-xl font-display text-ink-900">Not found</h2>
      <RouterLink to="/campaigns" class="link mt-3 inline-block">Back</RouterLink>
    </div>

    <template v-else>
      <PageHeader :title="encounter.title">
        <RouterLink :to="`/campaigns/${campaign.id}/encounters/${encounter.id}/edit`">
          <BaseButton>Edit</BaseButton>
        </RouterLink>
      </PageHeader>

      <SurfaceCard>
        <template #header>
          <div class="flex gap-2">
            <StatusBadge tone="info">{{ kindLabel(encounter.kind) }}</StatusBadge>
            <StatusBadge :tone="difficultyTone(encounter.difficulty)">{{ difficultyLabel(encounter.difficulty) }}</StatusBadge>
            <StatusBadge v-if="encounter.resolved" tone="neutral">Resolved</StatusBadge>
          </div>
        </template>
        <p v-if="encounter.summary" class="text-sm text-ink-700 whitespace-pre-line">{{ encounter.summary }}</p>
        <p v-else class="text-sm text-ink-400">No summary yet.</p>
      </SurfaceCard>

      <SurfaceCard title="Initiative" hint="Run combat or set it up beforehand">
        <InitiativeTracker
          :model-value="initiative"
          @update:model-value="onUpdateInitiative"
        />
      </SurfaceCard>

      <SurfaceCard title="Difficulty" hint="Rough verdict against the DMG xp table">
        <DifficultyCalculator />
      </SurfaceCard>

      <SurfaceCard title="Light and vision" hint="Track torches by the minute">
        <LightTrackerPanel :encounter-id="encounter.id as EncounterId" />
      </SurfaceCard>

      <SurfaceCard title="Tags" hint="Group recurring set pieces">
        <TagPicker
          :campaign-id="campaign.id as CampaignId"
          kind="encounter"
          :target-id="encounter.id"
        />
      </SurfaceCard>

      <SurfaceCard title="Runner" hint="Walk through the fight round by round">
        <InitiativeRunnerPanel
          :encounter-id="encounter.id as EncounterId"
          :entries="initiative"
          @entries-changed="onUpdateInitiative"
        />
      </SurfaceCard>

      <SurfaceCard title="Status">
        <div class="flex flex-wrap gap-2">
          <BaseButton @click="toggleResolved">
            {{ encounter.resolved ? 'Mark unresolved' : 'Mark resolved' }}
          </BaseButton>
          <BaseButton tone="danger" @click="deleteEncounter">Delete</BaseButton>
        </div>
      </SurfaceCard>
    </template>
  </section>
</template>
