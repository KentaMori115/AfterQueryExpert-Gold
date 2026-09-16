<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'

import type { ArcId, CampaignId } from '@core/ids'
import {
  ARC_STATUSES,
  ARC_TENSIONS,
  statusLabel,
  statusTone,
  tensionLabel,
  type ArcStatus,
  type ArcTension,
} from '@core/models/arc'

import { useCampaignStore } from '@features/campaigns/store'
import { useFactionStore } from '@features/factions/store'
import { useArcStore } from '../store'

import BaseButton from '@ui/primitives/BaseButton.vue'
import BreadcrumbTrail from '@ui/primitives/BreadcrumbTrail.vue'
import PageHeader from '@ui/primitives/PageHeader.vue'
import StatusBadge from '@ui/primitives/StatusBadge.vue'
import SurfaceCard from '@ui/primitives/SurfaceCard.vue'

const route = useRoute()
const router = useRouter()
const campaigns = useCampaignStore()
const factions = useFactionStore()
const arcs = useArcStore()

const campaignIdFromRoute = computed(() => route.params.campaignId as string)
const arcIdFromRoute = computed(() => route.params.id as string)

const campaign = computed(() => campaigns.all.find((c) => c.id === campaignIdFromRoute.value))
const arc = computed(() => arcs.byId(arcIdFromRoute.value as ArcId))

const primary = computed(() =>
  arc.value?.primaryFactionId ? factions.byId(arc.value.primaryFactionId) : null,
)
const rival = computed(() =>
  arc.value?.rivalFactionId ? factions.byId(arc.value.rivalFactionId) : null,
)

const crumbs = computed(() => [
  { to: '/', label: 'Home' },
  { to: '/campaigns', label: 'Campaigns' },
  {
    to: campaign.value ? `/campaigns/${campaign.value.id}` : '/campaigns',
    label: campaign.value?.name ?? 'Unknown',
  },
  {
    to: campaign.value ? `/campaigns/${campaign.value.id}/arcs` : '/campaigns',
    label: 'Arcs',
  },
  { label: arc.value?.title ?? 'Not found' },
])

function changeStatus(s: ArcStatus): void {
  if (arc.value) arcs.setStatus(arc.value.id as ArcId, s)
}

function changeTension(t: ArcTension): void {
  if (arc.value) arcs.setTension(arc.value.id as ArcId, t)
}

function deleteArc(): void {
  const a = arc.value
  if (!a || !campaign.value) return
  if (!window.confirm(`Delete "${a.title}"?`)) return
  arcs.remove(a.id as ArcId)
  router.push(`/campaigns/${campaign.value.id}/arcs`)
}
</script>

<template>
  <section class="container-wide py-8 space-y-6">
    <BreadcrumbTrail :crumbs="crumbs" />

    <div v-if="!campaign || !arc" class="surface p-8 text-center">
      <h2 class="text-xl font-display text-ink-900">Not found</h2>
      <RouterLink to="/campaigns" class="link mt-3 inline-block">Back</RouterLink>
    </div>

    <template v-else>
      <PageHeader :title="arc.title">
        <RouterLink :to="`/campaigns/${campaign.id}/arcs/${arc.id}/edit`">
          <BaseButton>Edit</BaseButton>
        </RouterLink>
      </PageHeader>

      <SurfaceCard>
        <template #header>
          <div class="flex gap-2">
            <StatusBadge :tone="statusTone(arc.status)">{{ statusLabel(arc.status) }}</StatusBadge>
            <StatusBadge tone="warning">{{ tensionLabel(arc.tension) }}</StatusBadge>
          </div>
        </template>
        <p v-if="arc.synopsis" class="text-sm text-ink-700 whitespace-pre-line">{{ arc.synopsis }}</p>
        <p v-else class="text-sm text-ink-400">No synopsis yet.</p>
      </SurfaceCard>

      <SurfaceCard v-if="primary || rival" title="Factions involved">
        <ul class="text-sm space-y-1">
          <li v-if="primary">
            <span class="text-ink-400 text-xs uppercase tracking-wider mr-2">Primary</span>
            <RouterLink :to="`/campaigns/${campaign.id}/factions/${primary.id}`" class="link">
              {{ primary.name }}
            </RouterLink>
          </li>
          <li v-if="rival">
            <span class="text-ink-400 text-xs uppercase tracking-wider mr-2">Rival</span>
            <RouterLink :to="`/campaigns/${campaign.id}/factions/${rival.id}`" class="link">
              {{ rival.name }}
            </RouterLink>
          </li>
        </ul>
      </SurfaceCard>

      <SurfaceCard title="Move it forward">
        <div class="flex flex-wrap gap-2">
          <button
            v-for="s in ARC_STATUSES"
            :key="s"
            type="button"
            class="px-2 py-1 rounded-soft text-xs uppercase tracking-wider"
            :class="arc.status === s ? 'bg-ink-700 text-white' : 'bg-parchment-100 text-ink-700 hover:bg-parchment-200'"
            @click="changeStatus(s)"
          >
            {{ statusLabel(s) }}
          </button>
        </div>
      </SurfaceCard>

      <SurfaceCard title="Tension">
        <div class="flex flex-wrap gap-2">
          <button
            v-for="t in ARC_TENSIONS"
            :key="t"
            type="button"
            class="px-2 py-1 rounded-soft text-xs uppercase tracking-wider"
            :class="arc.tension === t ? 'bg-crimson-500 text-white' : 'bg-parchment-100 text-ink-700 hover:bg-parchment-200'"
            @click="changeTension(t)"
          >
            {{ tensionLabel(t) }}
          </button>
        </div>
      </SurfaceCard>

      <SurfaceCard v-if="arc.notes" title="Notes">
        <p class="text-sm text-ink-700 whitespace-pre-line">{{ arc.notes }}</p>
      </SurfaceCard>

      <SurfaceCard title="Danger zone">
        <BaseButton tone="danger" @click="deleteArc">Delete this arc</BaseButton>
      </SurfaceCard>
    </template>
  </section>
</template>
