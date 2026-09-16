<script setup lang="ts">
import { computed, ref } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'

import type { CampaignId, LocationId } from '@core/ids'
import type { LocationDraftInput } from '@core/models/location'

import { useCampaignStore } from '@features/campaigns/store'
import { useLocationStore } from '../store'
import LocationForm from '../components/LocationForm.vue'

import BreadcrumbTrail from '@ui/primitives/BreadcrumbTrail.vue'
import PageHeader from '@ui/primitives/PageHeader.vue'
import SurfaceCard from '@ui/primitives/SurfaceCard.vue'

const route = useRoute()
const router = useRouter()
const campaigns = useCampaignStore()
const locations = useLocationStore()

const campaignIdFromRoute = computed(() => route.params.campaignId as string)
const locIdFromRoute = computed(() => route.params.id as string)

const campaign = computed(() => campaigns.all.find((c) => c.id === campaignIdFromRoute.value))
const location = computed(() => locations.byId(locIdFromRoute.value as LocationId))

const parents = computed(() =>
  campaign.value
    ? locations.forCampaign(campaign.value.id as CampaignId).filter((l) => l.id !== location.value?.id)
    : [],
)

const busy = ref(false)
const lastError = ref<string | null>(null)

const initial = computed<Partial<LocationDraftInput>>(() => {
  const l = location.value
  if (!l) return {}
  return {
    campaignId: l.campaignId,
    parentId: l.parentId,
    name: l.name,
    kind: l.kind,
    shortDescription: l.shortDescription,
    notes: l.notes,
    visited: l.visited,
  }
})

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
  {
    to: campaign.value && location.value
      ? `/campaigns/${campaign.value.id}/locations/${location.value.id}`
      : '/campaigns',
    label: location.value?.name ?? 'Unknown',
  },
  { label: 'Edit' },
])

async function submit(draft: LocationDraftInput): Promise<void> {
  if (!location.value || !campaign.value) return
  busy.value = true
  lastError.value = null
  try {
    locations.update(location.value.id as LocationId, draft)
    await router.push(`/campaigns/${campaign.value.id}/locations/${location.value.id}`)
  } catch (err) {
    lastError.value = err instanceof Error ? err.message : 'something went wrong'
  } finally {
    busy.value = false
  }
}

function cancel(): void {
  if (campaign.value && location.value)
    router.push(`/campaigns/${campaign.value.id}/locations/${location.value.id}`)
  else router.push('/campaigns')
}
</script>

<template>
  <section class="container-wide py-8 max-w-3xl space-y-6">
    <BreadcrumbTrail :crumbs="crumbs" />

    <div v-if="!campaign || !location" class="surface p-8 text-center">
      <h2 class="text-xl font-display text-ink-900">Not found</h2>
      <RouterLink to="/campaigns" class="link mt-3 inline-block">Back</RouterLink>
    </div>

    <template v-else>
      <PageHeader :title="`Editing: ${location.name}`" />
      <SurfaceCard>
        <LocationForm
          :campaign-id="campaign.id as CampaignId"
          :initial="initial"
          :parents="parents"
          :forbid-parent-id="location.id as LocationId"
          :busy="busy"
          submit-label="Save"
          cancel-label="Discard"
          @submit="submit"
          @cancel="cancel"
        />
        <p v-if="lastError" class="mt-3 text-sm text-crimson-600">{{ lastError }}</p>
      </SurfaceCard>
    </template>
  </section>
</template>
