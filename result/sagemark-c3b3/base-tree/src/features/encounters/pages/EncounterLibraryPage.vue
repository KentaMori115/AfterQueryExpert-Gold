<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import type { CampaignId } from '@core/ids'
import {
  TEMPLATE_ROLES,
  type EncounterTemplate,
  compareForListing,
  monsterCountFor,
  presetTemplates,
  roleLabel,
  roleTone,
  totalXpFor,
} from '@core/models/encounter-template'

import { useCampaignStore } from '@features/campaigns/store'
import { useEncounterStore } from '../store'

import BaseButton from '@ui/primitives/BaseButton.vue'
import BreadcrumbTrail from '@ui/primitives/BreadcrumbTrail.vue'
import EmptyState from '@ui/primitives/EmptyState.vue'
import PageHeader from '@ui/primitives/PageHeader.vue'
import StatusBadge from '@ui/primitives/StatusBadge.vue'
import SurfaceCard from '@ui/primitives/SurfaceCard.vue'

const route = useRoute()
const router = useRouter()
const campaigns = useCampaignStore()
const encounters = useEncounterStore()

const campaignIdFromRoute = computed(() => route.params.campaignId as string)
const campaign = computed(() => campaigns.all.find((c) => c.id === campaignIdFromRoute.value))

const filterLevel = ref<number>(0)
const filterRole = ref<string>('')

const templates = computed<EncounterTemplate[]>(() => {
  let list = [...presetTemplates()].sort(compareForListing)
  if (filterLevel.value > 0) {
    list = list.filter((t) => t.recommendedLevel === filterLevel.value)
  }
  if (filterRole.value) {
    list = list.filter((t) => t.monsters.some((m) => m.role === filterRole.value))
  }
  return list
})

function adopt(template: EncounterTemplate): void {
  if (!campaign.value) return
  const created = encounters.create({
    campaignId: campaign.value.id as CampaignId,
    title: template.name,
    kind: 'combat',
    summary: `${template.biome}\n\n${template.setupNote}`,
  })
  router.push(`/campaigns/${campaign.value.id}/encounters/${created.id}`)
}

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
  { label: 'Library' },
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
        title="Encounter library"
        subtitle="Drop a curated template into your campaign with one click."
      />

      <SurfaceCard title="Filters">
        <div class="flex flex-wrap items-end gap-3 text-xs">
          <label class="text-ink-500">
            Recommended level
            <input
              id="library-level"
              v-model.number="filterLevel"
              type="number"
              min="0"
              max="20"
              placeholder="any"
              class="mt-1 w-20 border border-parchment-300 rounded-soft px-2 py-1 bg-white"
            />
          </label>
          <label class="text-ink-500">
            Includes role
            <select
              id="library-role"
              v-model="filterRole"
              class="mt-1 border border-parchment-300 rounded-soft px-2 py-1 bg-white"
            >
              <option value="">any</option>
              <option v-for="role in TEMPLATE_ROLES" :key="role" :value="role">
                {{ roleLabel(role) }}
              </option>
            </select>
          </label>
        </div>
      </SurfaceCard>

      <EmptyState
        v-if="templates.length === 0"
        title="No templates match"
        description="Loosen the filters to see more options."
      />

      <ul v-else class="space-y-3">
        <li v-for="t in templates" :key="t.id" class="surface p-3 space-y-2">
          <header class="flex flex-wrap items-center gap-2">
            <span class="font-display text-lg text-ink-900">{{ t.name }}</span>
            <StatusBadge tone="info">level {{ t.recommendedLevel }}</StatusBadge>
            <span class="text-xs text-ink-500">{{ monsterCountFor(t) }} monsters, {{ totalXpFor(t) }} xp</span>
            <BaseButton size="sm" tone="primary" class="ml-auto" @click="adopt(t)">adopt</BaseButton>
          </header>
          <p class="text-sm text-ink-700">{{ t.setupNote }}</p>
          <p class="text-xs text-ink-500"><span class="uppercase tracking-wide">Biome: </span>{{ t.biome }}</p>
          <ul class="flex flex-wrap gap-1 text-xs">
            <li v-for="m in t.monsters" :key="m.name + m.role">
              <StatusBadge :tone="roleTone(m.role)">{{ m.count }} x {{ m.name }}</StatusBadge>
            </li>
          </ul>
        </li>
      </ul>
    </template>
  </section>
</template>
