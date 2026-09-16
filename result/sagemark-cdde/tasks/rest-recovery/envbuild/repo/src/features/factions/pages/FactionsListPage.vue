<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink, useRoute } from 'vue-router'

import type { CampaignId } from '@core/ids'

import { useCampaignStore } from '@features/campaigns/store'
import { useFactionStore } from '../store'
import FactionTile from '../components/FactionTile.vue'

import BaseButton from '@ui/primitives/BaseButton.vue'
import BreadcrumbTrail from '@ui/primitives/BreadcrumbTrail.vue'
import EmptyState from '@ui/primitives/EmptyState.vue'
import PageHeader from '@ui/primitives/PageHeader.vue'

const route = useRoute()
const campaigns = useCampaignStore()
const factions = useFactionStore()

const campaignIdFromRoute = computed(() => route.params.campaignId as string)
const campaign = computed(() => campaigns.all.find((c) => c.id === campaignIdFromRoute.value))

const all = computed(() => (campaign.value ? factions.forCampaign(campaign.value.id as CampaignId) : []))
const active = computed(() => all.value.filter((f) => f.active))
const dormant = computed(() => all.value.filter((f) => !f.active))

const sortedActive = computed(() => [...active.value].sort((a, b) => b.influence - a.influence))

const crumbs = computed(() => [
  { to: '/', label: 'Home' },
  { to: '/campaigns', label: 'Campaigns' },
  {
    to: campaign.value ? `/campaigns/${campaign.value.id}` : '/campaigns',
    label: campaign.value?.name ?? 'Unknown',
  },
  { label: 'Factions' },
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
        :title="`Factions of ${campaign.name}`"
        :meta="active.length + ' active / ' + all.length + ' total'"
      >
        <RouterLink :to="`/campaigns/${campaign.id}/factions/new`">
          <BaseButton tone="primary">New faction</BaseButton>
        </RouterLink>
      </PageHeader>

      <EmptyState
        v-if="all.length === 0"
        title="No factions yet"
        description="Even one petty merchant guild starts to shape the world once you write it down."
        icon="*"
      >
        <template #action>
          <RouterLink :to="`/campaigns/${campaign.id}/factions/new`">
            <BaseButton tone="primary">Start the first</BaseButton>
          </RouterLink>
        </template>
      </EmptyState>

      <template v-else>
        <section v-if="sortedActive.length > 0">
          <h2 class="text-sm uppercase tracking-wider text-ink-400 mb-2">In play, sorted by influence</h2>
          <ul class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <li v-for="f in sortedActive" :key="f.id">
              <RouterLink
                :to="`/campaigns/${campaign.id}/factions/${f.id}`"
                class="block focus:outline-none focus-visible:ring-2 focus-visible:ring-ember-400 rounded-soft"
              >
                <FactionTile :faction="f" />
              </RouterLink>
            </li>
          </ul>
        </section>
        <section v-if="dormant.length > 0">
          <h2 class="text-sm uppercase tracking-wider text-ink-400 mb-2">Dormant</h2>
          <ul class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <li v-for="f in dormant" :key="f.id">
              <RouterLink
                :to="`/campaigns/${campaign.id}/factions/${f.id}`"
                class="block focus:outline-none focus-visible:ring-2 focus-visible:ring-parchment-400 rounded-soft"
              >
                <FactionTile :faction="f" />
              </RouterLink>
            </li>
          </ul>
        </section>
      </template>
    </template>
  </section>
</template>
