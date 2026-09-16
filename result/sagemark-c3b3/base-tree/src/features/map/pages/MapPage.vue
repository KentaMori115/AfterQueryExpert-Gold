<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { RouterLink, useRoute } from 'vue-router'

import type { CampaignId, LocationId } from '@core/ids'
import {
  boundingBox,
  paddedBox,
  project,
  viewBox,
} from '@core/lib/map-geometry'

import { useCampaignStore } from '@features/campaigns/store'
import { useLocationStore } from '@features/locations/store'

import BaseButton from '@ui/primitives/BaseButton.vue'
import BreadcrumbTrail from '@ui/primitives/BreadcrumbTrail.vue'
import EmptyState from '@ui/primitives/EmptyState.vue'
import PageHeader from '@ui/primitives/PageHeader.vue'
import SurfaceCard from '@ui/primitives/SurfaceCard.vue'

import { useMapStore } from '../store'

const route = useRoute()
const campaigns = useCampaignStore()
const locations = useLocationStore()
const map = useMapStore()

const campaignIdFromRoute = computed(() => route.params.campaignId as string)
const campaign = computed(() => campaigns.all.find((c) => c.id === campaignIdFromRoute.value))

const placed = computed(() =>
  campaign.value ? map.forCampaign(campaign.value.id as CampaignId) : [],
)

const placedMap = computed(() => {
  const m = new Map<string, { x: number; y: number }>()
  for (const p of placed.value) m.set(p.locationId, { x: p.x, y: p.y })
  return m
})

const campaignLocations = computed(() =>
  campaign.value ? locations.forCampaign(campaign.value.id as CampaignId) : [],
)

const unplaced = computed(() =>
  campaignLocations.value.filter((l) => !placedMap.value.has(l.id)),
)

const bounds = computed(() => {
  const coords = placed.value.map((p) => ({ x: p.x, y: p.y }))
  const box = boundingBox(coords)
  if (!box) return null
  if (box.maxX === box.minX) {
    box.maxX = box.minX + 10
  }
  if (box.maxY === box.minY) {
    box.maxY = box.minY + 10
  }
  return paddedBox(box, 5)
})

const viewport = { width: 400, height: 280 }
const viewBoxString = computed(() => (bounds.value ? viewBox(bounds.value) : '0 0 100 100'))

const placeForm = reactive({
  locationId: '' as string,
  x: 0,
  y: 0,
})

function place(): void {
  if (!campaign.value || !placeForm.locationId) return
  map.placeAt(
    campaign.value.id as CampaignId,
    placeForm.locationId as LocationId,
    Number(placeForm.x),
    Number(placeForm.y),
  )
}

function unplace(locationId: LocationId): void {
  if (!campaign.value) return
  map.remove(campaign.value.id as CampaignId, locationId)
}

function projectPoint(p: { x: number; y: number }) {
  if (!bounds.value) return p
  return project(p, bounds.value, viewport)
}

function locationName(id: LocationId): string {
  return locations.byId(id)?.name ?? 'Unknown'
}

const crumbs = computed(() => [
  { to: '/', label: 'Home' },
  { to: '/campaigns', label: 'Campaigns' },
  {
    to: campaign.value ? `/campaigns/${campaign.value.id}` : '/campaigns',
    label: campaign.value?.name ?? 'Unknown',
  },
  { label: 'Map' },
])
</script>

<template>
  <section class="container-wide py-8 space-y-6 max-w-3xl">
    <BreadcrumbTrail :crumbs="crumbs" />

    <div v-if="!campaign" class="surface p-8 text-center">
      <h2 class="text-xl font-display text-ink-900">Campaign not found</h2>
    </div>

    <template v-else>
      <PageHeader
        title="Map"
        subtitle="Drop locations on a simple coordinate plane."
        :meta="placed.length + ' placed of ' + campaignLocations.length"
      />

      <SurfaceCard title="Plot">
        <EmptyState
          v-if="placed.length === 0"
          title="No places plotted yet"
          description="Pick a location below and assign rough coordinates."
        />
        <svg
          v-else
          :viewBox="viewBoxString"
          :width="viewport.width"
          :height="viewport.height"
          class="border border-parchment-200 rounded-soft bg-parchment-50 mx-auto block"
        >
          <g v-for="p in placed" :key="p.locationId">
            <circle
              :cx="p.x"
              :cy="p.y"
              r="4"
              class="fill-ember-500"
            />
            <text
              :x="p.x + 6"
              :y="p.y - 6"
              font-size="6"
              class="fill-ink-800 font-mono"
            >
              {{ locationName(p.locationId as LocationId) }}
            </text>
          </g>
        </svg>
      </SurfaceCard>

      <SurfaceCard title="Place a location">
        <form class="grid grid-cols-2 sm:grid-cols-4 gap-2" @submit.prevent="place">
          <select
            id="map-location"
            v-model="placeForm.locationId"
            class="sm:col-span-2 border border-parchment-300 rounded-soft px-2 py-1 text-sm bg-white"
          >
            <option value="">Pick a location</option>
            <option v-for="loc in unplaced" :key="loc.id" :value="loc.id">{{ loc.name }}</option>
          </select>
          <input
            id="map-x"
            v-model.number="placeForm.x"
            type="number"
            placeholder="x"
            class="border border-parchment-300 rounded-soft px-2 py-1 text-sm bg-white"
          />
          <input
            id="map-y"
            v-model.number="placeForm.y"
            type="number"
            placeholder="y"
            class="border border-parchment-300 rounded-soft px-2 py-1 text-sm bg-white"
          />
          <BaseButton size="sm" tone="primary" type="submit" class="sm:col-span-4 sm:justify-self-end">
            place
          </BaseButton>
        </form>
      </SurfaceCard>

      <SurfaceCard v-if="placed.length > 0" title="Placed">
        <ul class="text-sm space-y-1">
          <li v-for="p in placed" :key="p.locationId" class="flex items-center gap-2">
            <RouterLink
              :to="`/campaigns/${campaign.id}/locations/${p.locationId}`"
              class="link"
            >
              {{ locationName(p.locationId as LocationId) }}
            </RouterLink>
            <span class="text-xs text-ink-500">({{ p.x }}, {{ p.y }})</span>
            <button
              class="ml-auto text-xs text-crimson-600 hover:text-crimson-800"
              @click="unplace(p.locationId as LocationId)"
            >
              unplace
            </button>
          </li>
        </ul>
      </SurfaceCard>
    </template>
  </section>
</template>
