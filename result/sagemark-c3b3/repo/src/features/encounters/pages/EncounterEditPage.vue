<script setup lang="ts">
import { computed, ref } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'

import type { CampaignId, EncounterId } from '@core/ids'
import type { EncounterDraftInput } from '@core/models/encounter'

import { useCampaignStore } from '@features/campaigns/store'
import { useEncounterStore } from '../store'
import EncounterForm from '../components/EncounterForm.vue'

import BreadcrumbTrail from '@ui/primitives/BreadcrumbTrail.vue'
import PageHeader from '@ui/primitives/PageHeader.vue'
import SurfaceCard from '@ui/primitives/SurfaceCard.vue'

const route = useRoute()
const router = useRouter()
const campaigns = useCampaignStore()
const encounters = useEncounterStore()

const campaignIdFromRoute = computed(() => route.params.campaignId as string)
const encIdFromRoute = computed(() => route.params.id as string)

const campaign = computed(() => campaigns.all.find((c) => c.id === campaignIdFromRoute.value))
const encounter = computed(() => encounters.byId(encIdFromRoute.value as EncounterId))

const busy = ref(false)
const lastError = ref<string | null>(null)

const initial = computed<Partial<EncounterDraftInput>>(() => {
  const e = encounter.value
  if (!e) return {}
  return {
    campaignId: e.campaignId,
    title: e.title,
    kind: e.kind,
    difficulty: e.difficulty,
    summary: e.summary,
    resolved: e.resolved,
  }
})

const crumbs = computed(() => [
  { to: '/', label: 'Home' },
  { to: '/campaigns', label: 'Campaigns' },
  { to: campaign.value ? `/campaigns/${campaign.value.id}` : '/campaigns', label: campaign.value?.name ?? 'Unknown' },
  { to: campaign.value ? `/campaigns/${campaign.value.id}/encounters` : '/campaigns', label: 'Encounters' },
  {
    to: campaign.value && encounter.value
      ? `/campaigns/${campaign.value.id}/encounters/${encounter.value.id}`
      : '/campaigns',
    label: encounter.value?.title || 'Unknown',
  },
  { label: 'Edit' },
])

async function submit(draft: EncounterDraftInput): Promise<void> {
  if (!encounter.value || !campaign.value) return
  busy.value = true
  lastError.value = null
  try {
    encounters.update(encounter.value.id as EncounterId, draft)
    await router.push(`/campaigns/${campaign.value.id}/encounters/${encounter.value.id}`)
  } catch (err) {
    lastError.value = err instanceof Error ? err.message : 'something went wrong'
  } finally {
    busy.value = false
  }
}

function cancel(): void {
  if (campaign.value && encounter.value)
    router.push(`/campaigns/${campaign.value.id}/encounters/${encounter.value.id}`)
  else router.push('/campaigns')
}
</script>

<template>
  <section class="container-wide py-8 max-w-3xl space-y-6">
    <BreadcrumbTrail :crumbs="crumbs" />

    <div v-if="!campaign || !encounter" class="surface p-8 text-center">
      <h2 class="text-xl font-display text-ink-900">Not found</h2>
      <RouterLink to="/campaigns" class="link mt-3 inline-block">Back</RouterLink>
    </div>

    <template v-else>
      <PageHeader :title="`Editing: ${encounter.title}`" />
      <SurfaceCard>
        <EncounterForm
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
