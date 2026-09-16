<script setup lang="ts">
import { computed, ref } from 'vue'
import { RouterLink, useRoute } from 'vue-router'

import type { CampaignId } from '@core/ids'
import { paginate, pageInfoOf } from '@core/lib/paginate'

import { useCampaignStore } from '@features/campaigns/store'
import { useCharacterStore } from '../store'
import CharacterTile from '../components/CharacterTile.vue'

import BaseButton from '@ui/primitives/BaseButton.vue'
import BreadcrumbTrail from '@ui/primitives/BreadcrumbTrail.vue'
import EmptyState from '@ui/primitives/EmptyState.vue'
import PageHeader from '@ui/primitives/PageHeader.vue'

const route = useRoute()
const campaigns = useCampaignStore()
const characters = useCharacterStore()

const PER_PAGE = 18
const page = ref(0)

const campaignIdFromRoute = computed(() => route.params.campaignId as string)
const campaign = computed(() => campaigns.all.find((c) => c.id === campaignIdFromRoute.value))

const allCast = computed(() =>
  campaign.value ? characters.forCampaign(campaign.value.id as CampaignId) : [],
)
const pcs = computed(() => allCast.value.filter((c) => c.kind === 'pc'))
const npcs = computed(() => allCast.value.filter((c) => c.kind === 'npc'))

const pageInfo = computed(() => pageInfoOf(npcs.value.length, { page: page.value, perPage: PER_PAGE }))
const pagedNpcs = computed(() => paginate(npcs.value, { page: page.value, perPage: PER_PAGE }))

const crumbs = computed(() => [
  { to: '/', label: 'Home' },
  { to: '/campaigns', label: 'Campaigns' },
  {
    to: campaign.value ? `/campaigns/${campaign.value.id}` : '/campaigns',
    label: campaign.value?.name ?? 'Unknown',
  },
  { label: 'Cast' },
])

function gotoPage(p: number): void {
  page.value = p
}
</script>

<template>
  <section class="container-wide py-8 space-y-6">
    <BreadcrumbTrail :crumbs="crumbs" />

    <div v-if="!campaign" class="surface p-8 text-center">
      <h2 class="text-xl font-display text-ink-900">Campaign not found</h2>
      <RouterLink to="/campaigns" class="link mt-3 inline-block">Back to campaigns</RouterLink>
    </div>

    <template v-else>
      <PageHeader
        :title="`Cast of ${campaign.name}`"
        :meta="pcs.length + ' players / ' + npcs.length + ' non-players'"
      >
        <RouterLink :to="`/campaigns/${campaign.id}/characters/new`">
          <BaseButton tone="primary">Add character</BaseButton>
        </RouterLink>
      </PageHeader>

      <EmptyState
        v-if="allCast.length === 0"
        title="No one is on the page yet"
        description="Add the party first, then bring in the people they will meet."
        icon="*"
      >
        <template #action>
          <RouterLink :to="`/campaigns/${campaign.id}/characters/new`">
            <BaseButton tone="primary">Add the first character</BaseButton>
          </RouterLink>
        </template>
      </EmptyState>

      <template v-else>
        <section v-if="pcs.length > 0">
          <h2 class="text-sm uppercase tracking-wider text-ink-400 mb-2">The party</h2>
          <ul class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <li v-for="c in pcs" :key="c.id">
              <RouterLink
                :to="`/campaigns/${campaign.id}/characters/${c.id}`"
                class="block focus:outline-none focus-visible:ring-2 focus-visible:ring-ember-400 rounded-soft"
              >
                <CharacterTile :character="c" />
              </RouterLink>
            </li>
          </ul>
        </section>

        <section v-if="npcs.length > 0">
          <h2 class="text-sm uppercase tracking-wider text-ink-400 mb-2">Everyone else</h2>
          <ul class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <li v-for="c in pagedNpcs" :key="c.id">
              <RouterLink
                :to="`/campaigns/${campaign.id}/characters/${c.id}`"
                class="block focus:outline-none focus-visible:ring-2 focus-visible:ring-parchment-400 rounded-soft"
              >
                <CharacterTile :character="c" />
              </RouterLink>
            </li>
          </ul>
          <div v-if="pageInfo.totalPages > 1" class="mt-3 flex items-center justify-end gap-1 text-sm">
            <button
              v-for="p in pageInfo.totalPages"
              :key="p"
              type="button"
              class="px-2 py-1 rounded hover:bg-parchment-100"
              :class="p - 1 === pageInfo.page ? 'bg-parchment-200 text-ink-900' : 'text-ink-600'"
              @click="gotoPage(p - 1)"
            >
              {{ p }}
            </button>
          </div>
        </section>
      </template>
    </template>
  </section>
</template>
