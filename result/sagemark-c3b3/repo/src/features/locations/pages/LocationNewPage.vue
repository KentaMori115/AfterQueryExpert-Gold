<script setup lang="ts">
import { computed, ref } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'

import type { CampaignId } from '@core/ids'
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
const campaign = computed(() => campaigns.all.find((c) => c.id === campaignIdFromRoute.value))

const parents = computed(() =>
  campaign.value ? locations.forCampaign(campaign.value.id as CampaignId) : [],
)

const busy = ref(false)
const lastError = ref<string | null>(null)

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
  { label: 'New' },
])

async function submit(draft: LocationDraftInput): Promise<void> {
  if (!campaign.value) return
  busy.value = true
  lastError.value = null
  try {
    const created = locations.create({
      ...draft,
      campaignId: campaign.value.id as CampaignId,
    })
    await router.push(`/campaigns/${campaign.value.id}/locations/${created.id}`)
  } catch (err) {
    lastError.value = err instanceof Error ? err.message : 'something went wrong'
  } finally {
    busy.value = false
  }
}

function cancel(): void {
  if (campaign.value) router.push(`/campaigns/${campaign.value.id}/locations`)
  else router.push('/campaigns')
}
</script>

<template>
  <section class="container-wide py-8 max-w-3xl space-y-6">
    <BreadcrumbTrail :crumbs="crumbs" />

    <div v-if="!campaign" class="surface p-8 text-center">
      <h2 class="text-xl font-display text-ink-900">Campaign not found</h2>
      <RouterLink to="/campaigns" class="link mt-3 inline-block">Back</RouterLink>
    </div>

    <template v-else>
      <PageHeader title="New place" />
      <SurfaceCard>
        <LocationForm
          :campaign-id="campaign.id as CampaignId"
          :parents="parents"
          :busy="busy"
          submit-label="Create"
          cancel-label="Back"
          @submit="submit"
          @cancel="cancel"
        />
        <p v-if="lastError" class="mt-3 text-sm text-crimson-600">{{ lastError }}</p>
      </SurfaceCard>
    </template>
  </section>
</template>
