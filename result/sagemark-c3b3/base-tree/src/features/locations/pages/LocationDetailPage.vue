<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'

import type { CampaignId, LocationId } from '@core/ids'
import { ancestorChain, kindLabel } from '@core/models/location'

import { useCampaignStore } from '@features/campaigns/store'
import { useLocationStore } from '../store'

import BaseButton from '@ui/primitives/BaseButton.vue'
import BreadcrumbTrail from '@ui/primitives/BreadcrumbTrail.vue'
import PageHeader from '@ui/primitives/PageHeader.vue'
import StatusBadge from '@ui/primitives/StatusBadge.vue'
import SurfaceCard from '@ui/primitives/SurfaceCard.vue'
import NotesPanel from '@features/notes/components/NotesPanel.vue'
import TagPicker from '@features/tags/components/TagPicker.vue'

const route = useRoute()
const router = useRouter()
const campaigns = useCampaignStore()
const locations = useLocationStore()

const campaignIdFromRoute = computed(() => route.params.campaignId as string)
const locIdFromRoute = computed(() => route.params.id as string)

const campaign = computed(() => campaigns.all.find((c) => c.id === campaignIdFromRoute.value))
const location = computed(() => locations.byId(locIdFromRoute.value as LocationId))

const all = computed(() =>
  campaign.value ? locations.forCampaign(campaign.value.id as CampaignId) : [],
)
const ancestors = computed(() => ancestorChain(location.value, all.value))
const children = computed(() =>
  location.value ? all.value.filter((l) => l.parentId === location.value!.id) : [],
)

const crumbs = computed(() => [
  { to: '/', label: 'Home' },
  { to: '/campaigns', label: 'Campaigns' },
  {
    to: campaign.value ? `/campaigns/${campaign.value.id}` : '/campaigns',
    label: campaign.value?.name ?? 'Unknown',
  },
  {
    to: campaign.value ? `/campaigns/${campaign.value.id}/locations` : '/campaigns',
    label: 'World',
  },
  ...ancestors.value
    .slice(0, -1)
    .map((a) => ({
      to: `/campaigns/${campaign.value!.id}/locations/${a.id}`,
      label: a.name,
    })),
  { label: location.value?.name ?? 'Not found' },
])

function toggleVisited(): void {
  const l = location.value
  if (!l) return
  locations.setVisited(l.id as LocationId, !l.visited)
}

function deleteLocation(): void {
  const l = location.value
  if (!l || !campaign.value) return
  const cascade = children.value.length > 0
  const message = cascade
    ? `"${l.name}" has ${children.value.length} children. Delete the whole subtree?`
    : `Delete "${l.name}"?`
  if (!window.confirm(message)) return
  locations.remove(l.id as LocationId, cascade)
  router.push(`/campaigns/${campaign.value.id}/locations`)
}
</script>

<template>
  <section class="container-wide py-8 space-y-6">
    <BreadcrumbTrail :crumbs="crumbs" />

    <div v-if="!campaign || !location" class="surface p-8 text-center">
      <h2 class="text-xl font-display text-ink-900">Not found</h2>
      <RouterLink to="/campaigns" class="link mt-3 inline-block">Back</RouterLink>
    </div>

    <template v-else>
      <PageHeader :title="location.name" :subtitle="location.shortDescription || undefined">
        <RouterLink :to="`/campaigns/${campaign.id}/locations/${location.id}/edit`">
          <BaseButton>Edit</BaseButton>
        </RouterLink>
      </PageHeader>

      <SurfaceCard>
        <template #header>
          <div class="flex gap-2">
            <StatusBadge tone="info">{{ kindLabel(location.kind) }}</StatusBadge>
            <StatusBadge v-if="location.visited" tone="success">Visited</StatusBadge>
          </div>
        </template>
        <p v-if="location.notes" class="text-sm text-ink-700 whitespace-pre-line">
          {{ location.notes }}
        </p>
        <p v-else class="text-sm text-ink-400">No notes yet.</p>
      </SurfaceCard>

      <SurfaceCard v-if="children.length > 0" title="Inside this place">
        <ul class="text-sm space-y-1">
          <li v-for="c in children" :key="c.id">
            <RouterLink :to="`/campaigns/${campaign.id}/locations/${c.id}`" class="link">
              {{ c.name }}
            </RouterLink>
            <span class="ml-2 text-xs text-ink-400">{{ kindLabel(c.kind) }}</span>
          </li>
        </ul>
      </SurfaceCard>

      <SurfaceCard title="Tags" hint="Sort places by climate, danger and the like">
        <TagPicker
          :campaign-id="campaign.id as CampaignId"
          kind="location"
          :target-id="location.id"
        />
      </SurfaceCard>

      <SurfaceCard>
        <NotesPanel
          :campaign-id="campaign.id as CampaignId"
          :target="{ kind: 'location', id: location.id }"
          title="Notes on this place"
        />
      </SurfaceCard>

      <SurfaceCard title="Status">
        <div class="flex flex-wrap gap-2">
          <BaseButton @click="toggleVisited">
            {{ location.visited ? 'Mark unvisited' : 'Mark visited' }}
          </BaseButton>
          <BaseButton tone="danger" @click="deleteLocation">
            {{ children.length > 0 ? 'Delete subtree' : 'Delete' }}
          </BaseButton>
        </div>
      </SurfaceCard>
    </template>
  </section>
</template>
