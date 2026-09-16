<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink, useRoute } from 'vue-router'

import type { CampaignId } from '@core/ids'

import { useCampaignStore } from '@features/campaigns/store'
import { useLocationStore } from '../store'
import LocationTreeView from '../components/LocationTreeView.vue'

import BaseButton from '@ui/primitives/BaseButton.vue'
import BreadcrumbTrail from '@ui/primitives/BreadcrumbTrail.vue'
import EmptyState from '@ui/primitives/EmptyState.vue'
import PageHeader from '@ui/primitives/PageHeader.vue'
import SurfaceCard from '@ui/primitives/SurfaceCard.vue'

const route = useRoute()
const campaigns = useCampaignStore()
const locations = useLocationStore()

const campaignIdFromRoute = computed(() => route.params.campaignId as string)
const campaign = computed(() => campaigns.all.find((c) => c.id === campaignIdFromRoute.value))

const tree = computed(() =>
  campaign.value ? locations.treeFor(campaign.value.id as CampaignId) : [],
)
const totalCount = computed(() =>
  campaign.value ? locations.forCampaign(campaign.value.id as CampaignId).length : 0,
)
const visitedCount = computed(() =>
  campaign.value
    ? locations.forCampaign(campaign.value.id as CampaignId).filter((l) => l.visited).length
    : 0,
)

const crumbs = computed(() => [
  { to: '/', label: 'Home' },
  { to: '/campaigns', label: 'Campaigns' },
  {
    to: campaign.value ? `/campaigns/${campaign.value.id}` : '/campaigns',
    label: campaign.value?.name ?? 'Unknown',
  },
  { label: 'World' },
])
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
        title="The world"
        :meta="visitedCount + ' visited / ' + totalCount + ' mapped'"
      >
        <RouterLink :to="`/campaigns/${campaign.id}/locations/new`">
          <BaseButton tone="primary">New place</BaseButton>
        </RouterLink>
      </PageHeader>

      <EmptyState
        v-if="totalCount === 0"
        title="No places mapped"
        description="Start with a continent or just a town. You can nest the rest underneath later."
        icon="*"
      >
        <template #action>
          <RouterLink :to="`/campaigns/${campaign.id}/locations/new`">
            <BaseButton tone="primary">Add the first</BaseButton>
          </RouterLink>
        </template>
      </EmptyState>

      <SurfaceCard v-else>
        <LocationTreeView
          :tree="tree"
          :route-base="`/campaigns/${campaign.id}/locations`"
        />
      </SurfaceCard>
    </template>
  </section>
</template>
