<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'

import { useCampaignStore } from '@features/campaigns/store'

import BreadcrumbTrail from '@ui/primitives/BreadcrumbTrail.vue'
import PageHeader from '@ui/primitives/PageHeader.vue'
import SurfaceCard from '@ui/primitives/SurfaceCard.vue'

import DifficultyCalculator from '../components/DifficultyCalculator.vue'

const route = useRoute()
const campaigns = useCampaignStore()

const campaignIdFromRoute = computed(() => route.params.campaignId as string)
const campaign = computed(() => campaigns.all.find((c) => c.id === campaignIdFromRoute.value))

const crumbs = computed(() => [
  { to: '/', label: 'Home' },
  { to: '/campaigns', label: 'Campaigns' },
  {
    to: campaign.value ? `/campaigns/${campaign.value.id}` : '/campaigns',
    label: campaign.value?.name ?? 'Unknown',
  },
  {
    to: campaign.value ? `/campaigns/${campaign.value.id}/encounters` : '/campaigns',
    label: 'Encounters',
  },
  { label: 'Difficulty bench' },
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
        title="Difficulty bench"
        subtitle="Throw monsters at the math without owning an encounter."
      />

      <SurfaceCard title="Calculator">
        <DifficultyCalculator />
      </SurfaceCard>

      <SurfaceCard title="How this works" hint="A pocket primer">
        <p class="text-sm text-ink-700">
          The bench leans on the DMG XP table, the group multiplier for the number of monsters
          you face, and a small bump up for parties of two or fewer or a bump down for parties of
          six or more.
        </p>
        <p class="text-sm text-ink-700 mt-2">
          Raw XP is the plain sum of every monster you list. Effective XP is what the party
          actually feels after the multiplier is applied, so use that number when comparing
          against the verdict thresholds.
        </p>
      </SurfaceCard>
    </template>
  </section>
</template>
