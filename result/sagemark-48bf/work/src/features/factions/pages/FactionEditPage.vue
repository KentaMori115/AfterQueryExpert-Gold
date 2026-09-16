<script setup lang="ts">
import { computed, ref } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'

import type { CampaignId, FactionId } from '@core/ids'
import type { FactionDraftInput } from '@core/models/faction'

import { useCampaignStore } from '@features/campaigns/store'
import { useFactionStore } from '../store'
import FactionForm from '../components/FactionForm.vue'

import BreadcrumbTrail from '@ui/primitives/BreadcrumbTrail.vue'
import PageHeader from '@ui/primitives/PageHeader.vue'
import SurfaceCard from '@ui/primitives/SurfaceCard.vue'

const route = useRoute()
const router = useRouter()
const campaigns = useCampaignStore()
const factions = useFactionStore()

const campaignIdFromRoute = computed(() => route.params.campaignId as string)
const facIdFromRoute = computed(() => route.params.id as string)

const campaign = computed(() => campaigns.all.find((c) => c.id === campaignIdFromRoute.value))
const faction = computed(() => factions.byId(facIdFromRoute.value as FactionId))

const busy = ref(false)
const lastError = ref<string | null>(null)

const initial = computed<Partial<FactionDraftInput>>(() => {
  const f = faction.value
  if (!f) return {}
  return {
    campaignId: f.campaignId,
    name: f.name,
    motto: f.motto,
    description: f.description,
    alignment: f.alignment,
    scope: f.scope,
    influence: f.influence,
    active: f.active,
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
    to: campaign.value ? `/campaigns/${campaign.value.id}/factions` : '/campaigns',
    label: 'Factions',
  },
  {
    to: faction.value && campaign.value
      ? `/campaigns/${campaign.value.id}/factions/${faction.value.id}`
      : '/campaigns',
    label: faction.value?.name ?? 'Unknown',
  },
  { label: 'Edit' },
])

async function submit(draft: FactionDraftInput): Promise<void> {
  if (!faction.value || !campaign.value) return
  busy.value = true
  lastError.value = null
  try {
    factions.update(faction.value.id as FactionId, draft)
    await router.push(`/campaigns/${campaign.value.id}/factions/${faction.value.id}`)
  } catch (err) {
    lastError.value = err instanceof Error ? err.message : 'something went wrong'
  } finally {
    busy.value = false
  }
}

function cancel(): void {
  if (campaign.value && faction.value)
    router.push(`/campaigns/${campaign.value.id}/factions/${faction.value.id}`)
  else router.push('/campaigns')
}
</script>

<template>
  <section class="container-wide py-8 max-w-3xl space-y-6">
    <BreadcrumbTrail :crumbs="crumbs" />

    <div v-if="!campaign || !faction" class="surface p-8 text-center">
      <h2 class="text-xl font-display text-ink-900">Not found</h2>
      <RouterLink to="/campaigns" class="link mt-3 inline-block">Back</RouterLink>
    </div>

    <template v-else>
      <PageHeader :title="`Editing: ${faction.name}`" />
      <SurfaceCard>
        <FactionForm
          :campaign-id="campaign.id as CampaignId"
          :initial="initial"
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
