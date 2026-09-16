<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink, useRoute } from 'vue-router'

import type { CampaignId } from '@core/ids'

import { useCampaignStore } from '@features/campaigns/store'
import { useEncounterStore } from '../store'
import EncounterCard from '../components/EncounterCard.vue'

import BaseButton from '@ui/primitives/BaseButton.vue'
import BreadcrumbTrail from '@ui/primitives/BreadcrumbTrail.vue'
import EmptyState from '@ui/primitives/EmptyState.vue'
import PageHeader from '@ui/primitives/PageHeader.vue'

const route = useRoute()
const campaigns = useCampaignStore()
const encounters = useEncounterStore()

const campaignIdFromRoute = computed(() => route.params.campaignId as string)
const campaign = computed(() => campaigns.all.find((c) => c.id === campaignIdFromRoute.value))

const all = computed(() =>
  campaign.value ? encounters.forCampaign(campaign.value.id as CampaignId) : [],
)
const open = computed(() => all.value.filter((e) => !e.resolved))
const resolved = computed(() => all.value.filter((e) => e.resolved))

const crumbs = computed(() => [
  { to: '/', label: 'Home' },
  { to: '/campaigns', label: 'Campaigns' },
  {
    to: campaign.value ? `/campaigns/${campaign.value.id}` : '/campaigns',
    label: campaign.value?.name ?? 'Unknown',
  },
  { label: 'Encounters' },
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
        title="Encounters"
        subtitle="Set pieces ready to drop into a session."
        :meta="open.length + ' open / ' + all.length + ' total'"
      >
        <RouterLink :to="`/campaigns/${campaign.id}/encounters/library`" class="mr-2">
          <BaseButton>Library</BaseButton>
        </RouterLink>
        <RouterLink :to="`/campaigns/${campaign.id}/encounters/bench`" class="mr-2">
          <BaseButton>Bench</BaseButton>
        </RouterLink>
        <RouterLink :to="`/campaigns/${campaign.id}/encounters/new`">
          <BaseButton tone="primary">New encounter</BaseButton>
        </RouterLink>
      </PageHeader>

      <EmptyState
        v-if="all.length === 0"
        title="No encounters yet"
        description="Build a library you can pull from when the party heads somewhere unexpected."
        icon="*"
      >
        <template #action>
          <RouterLink :to="`/campaigns/${campaign.id}/encounters/new`">
            <BaseButton tone="primary">Draft the first</BaseButton>
          </RouterLink>
        </template>
      </EmptyState>

      <template v-else>
        <section v-if="open.length > 0">
          <h2 class="text-sm uppercase tracking-wider text-ink-400 mb-2">Ready to drop</h2>
          <ul class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <li v-for="e in open" :key="e.id">
              <RouterLink :to="`/campaigns/${campaign.id}/encounters/${e.id}`" class="block rounded-soft focus:outline-none focus-visible:ring-2 focus-visible:ring-ember-400">
                <EncounterCard :encounter="e" />
              </RouterLink>
            </li>
          </ul>
        </section>

        <section v-if="resolved.length > 0">
          <h2 class="text-sm uppercase tracking-wider text-ink-400 mb-2">Played out</h2>
          <ul class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <li v-for="e in resolved" :key="e.id">
              <RouterLink :to="`/campaigns/${campaign.id}/encounters/${e.id}`" class="block rounded-soft focus:outline-none focus-visible:ring-2 focus-visible:ring-parchment-400">
                <EncounterCard :encounter="e" />
              </RouterLink>
            </li>
          </ul>
        </section>
      </template>
    </template>
  </section>
</template>
