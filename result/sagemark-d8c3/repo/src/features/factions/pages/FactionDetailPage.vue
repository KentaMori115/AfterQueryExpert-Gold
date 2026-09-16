<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'

import type { CampaignId, FactionId } from '@core/ids'
import {
  alignmentLabel,
  alignmentTone,
  influenceTierLabel,
  scopeLabel,
} from '@core/models/faction'

import { useCampaignStore } from '@features/campaigns/store'
import { useCharacterStore } from '@features/characters/store'
import { useFactionStore } from '../store'

import BaseButton from '@ui/primitives/BaseButton.vue'
import BreadcrumbTrail from '@ui/primitives/BreadcrumbTrail.vue'
import PageHeader from '@ui/primitives/PageHeader.vue'
import StatusBadge from '@ui/primitives/StatusBadge.vue'
import SurfaceCard from '@ui/primitives/SurfaceCard.vue'
import NotesPanel from '@features/notes/components/NotesPanel.vue'
import InfluenceTrendPanel from '@features/influence/components/InfluenceTrendPanel.vue'
import BacklinksPanel from '@features/backlinks/components/BacklinksPanel.vue'
import TagPicker from '@features/tags/components/TagPicker.vue'

const route = useRoute()
const router = useRouter()
const campaigns = useCampaignStore()
const characters = useCharacterStore()
const factions = useFactionStore()

const campaignIdFromRoute = computed(() => route.params.campaignId as string)
const facIdFromRoute = computed(() => route.params.id as string)

const campaign = computed(() => campaigns.all.find((c) => c.id === campaignIdFromRoute.value))
const faction = computed(() => factions.byId(facIdFromRoute.value as FactionId))

const leader = computed(() => {
  const f = faction.value
  if (!f?.leaderId) return null
  return characters.byId(f.leaderId)
})

const crumbs = computed(() => [
  { to: '/', label: 'Home' },
  { to: '/campaigns', label: 'Campaigns' },
  {
    to: campaign.value ? `/campaigns/${campaign.value.id}` : '/campaigns',
    label: campaign.value?.name ?? 'Unknown',
  },
  {
    to: campaign.value ? `/campaigns/${campaign.value.id}/factions` : '/campaigns',
    label: 'Factions',
  },
  { label: faction.value?.name ?? 'Not found' },
])

function bump(delta: number): void {
  if (faction.value) factions.adjustInfluence(faction.value.id as FactionId, delta)
}

function toggleActive(): void {
  if (faction.value) factions.setActive(faction.value.id as FactionId, !faction.value.active)
}

function deleteFaction(): void {
  if (!faction.value || !campaign.value) return
  if (!window.confirm(`Remove "${faction.value.name}" from the campaign?`)) return
  factions.remove(faction.value.id as FactionId)
  router.push(`/campaigns/${campaign.value.id}/factions`)
}
</script>

<template>
  <section class="container-wide py-8 space-y-6">
    <BreadcrumbTrail :crumbs="crumbs" />

    <div v-if="!campaign || !faction" class="surface p-8 text-center">
      <h2 class="text-xl font-display text-ink-900">Not found</h2>
      <RouterLink to="/campaigns" class="link mt-3 inline-block">Back</RouterLink>
    </div>

    <template v-else>
      <PageHeader :title="faction.name" :subtitle="faction.motto || undefined">
        <RouterLink :to="`/campaigns/${campaign.id}/factions/${faction.id}/edit`">
          <BaseButton>Edit</BaseButton>
        </RouterLink>
      </PageHeader>

      <SurfaceCard>
        <template #header>
          <div class="flex gap-2">
            <StatusBadge :tone="alignmentTone(faction.alignment)">{{ alignmentLabel(faction.alignment) }}</StatusBadge>
            <StatusBadge v-if="!faction.active" tone="neutral">Dormant</StatusBadge>
          </div>
        </template>
        <dl class="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
          <div>
            <dt class="text-xs uppercase tracking-wider text-ink-400">Scope</dt>
            <dd class="text-ink-800">{{ scopeLabel(faction.scope) }}</dd>
          </div>
          <div>
            <dt class="text-xs uppercase tracking-wider text-ink-400">Influence</dt>
            <dd class="text-ink-800">{{ faction.influence }} / 100 - {{ influenceTierLabel(faction.influence) }}</dd>
          </div>
          <div>
            <dt class="text-xs uppercase tracking-wider text-ink-400">Leader</dt>
            <dd class="text-ink-800">
              <RouterLink
                v-if="leader"
                :to="`/campaigns/${campaign.id}/characters/${leader.id}`"
                class="link"
              >
                {{ leader.name }}
              </RouterLink>
              <span v-else>Unknown</span>
            </dd>
          </div>
        </dl>
        <p v-if="faction.description" class="mt-3 text-sm text-ink-700 whitespace-pre-line">
          {{ faction.description }}
        </p>
      </SurfaceCard>

      <SurfaceCard title="Influence" hint="Quick adjustments after a session">
        <div class="flex flex-wrap gap-2">
          <BaseButton @click="bump(-10)">-10</BaseButton>
          <BaseButton @click="bump(-5)">-5</BaseButton>
          <BaseButton @click="bump(5)">+5</BaseButton>
          <BaseButton @click="bump(10)">+10</BaseButton>
        </div>
      </SurfaceCard>

      <SurfaceCard title="Tags" hint="Group factions by theme or schemes shared">
        <TagPicker
          :campaign-id="campaign.id as CampaignId"
          kind="faction"
          :target-id="faction.id"
        />
      </SurfaceCard>

      <SurfaceCard>
        <InfluenceTrendPanel
          :campaign-id="campaign.id as CampaignId"
          :faction-id="faction.id as FactionId"
          :current-influence="faction.influence"
        />
      </SurfaceCard>

      <SurfaceCard>
        <NotesPanel
          :campaign-id="campaign.id as CampaignId"
          :target="{ kind: 'faction', id: faction.id }"
          title="Notes on this faction"
        />
      </SurfaceCard>

      <SurfaceCard>
        <BacklinksPanel
          :campaign-id="campaign.id as CampaignId"
          :name="faction.name"
          title="Mentions across the campaign"
        />
      </SurfaceCard>

      <SurfaceCard title="Status" hint="One-way operations">
        <div class="flex flex-wrap gap-2">
          <BaseButton @click="toggleActive">
            {{ faction.active ? 'Mark dormant' : 'Bring back into play' }}
          </BaseButton>
          <BaseButton tone="danger" @click="deleteFaction">Remove</BaseButton>
        </div>
      </SurfaceCard>
    </template>
  </section>
</template>
