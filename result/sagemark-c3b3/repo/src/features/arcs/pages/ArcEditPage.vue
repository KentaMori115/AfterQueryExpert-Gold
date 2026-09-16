<script setup lang="ts">
import { computed, ref } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'

import type { ArcId, CampaignId } from '@core/ids'
import type { ArcDraftInput } from '@core/models/arc'

import { useCampaignStore } from '@features/campaigns/store'
import { useArcStore } from '../store'
import ArcForm from '../components/ArcForm.vue'

import BreadcrumbTrail from '@ui/primitives/BreadcrumbTrail.vue'
import PageHeader from '@ui/primitives/PageHeader.vue'
import SurfaceCard from '@ui/primitives/SurfaceCard.vue'

const route = useRoute()
const router = useRouter()
const campaigns = useCampaignStore()
const arcs = useArcStore()

const campaignIdFromRoute = computed(() => route.params.campaignId as string)
const arcIdFromRoute = computed(() => route.params.id as string)

const campaign = computed(() => campaigns.all.find((c) => c.id === campaignIdFromRoute.value))
const arc = computed(() => arcs.byId(arcIdFromRoute.value as ArcId))

const busy = ref(false)
const lastError = ref<string | null>(null)

const initial = computed<Partial<ArcDraftInput>>(() => {
  const a = arc.value
  if (!a) return {}
  return {
    campaignId: a.campaignId,
    title: a.title,
    synopsis: a.synopsis,
    status: a.status,
    tension: a.tension,
    notes: a.notes,
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
    to: campaign.value ? `/campaigns/${campaign.value.id}/arcs` : '/campaigns',
    label: 'Arcs',
  },
  {
    to: campaign.value && arc.value
      ? `/campaigns/${campaign.value.id}/arcs/${arc.value.id}`
      : '/campaigns',
    label: arc.value?.title || 'Unknown',
  },
  { label: 'Edit' },
])

async function submit(draft: ArcDraftInput): Promise<void> {
  if (!arc.value || !campaign.value) return
  busy.value = true
  lastError.value = null
  try {
    arcs.update(arc.value.id as ArcId, draft)
    await router.push(`/campaigns/${campaign.value.id}/arcs/${arc.value.id}`)
  } catch (err) {
    lastError.value = err instanceof Error ? err.message : 'something went wrong'
  } finally {
    busy.value = false
  }
}

function cancel(): void {
  if (campaign.value && arc.value)
    router.push(`/campaigns/${campaign.value.id}/arcs/${arc.value.id}`)
  else router.push('/campaigns')
}
</script>

<template>
  <section class="container-wide py-8 max-w-3xl space-y-6">
    <BreadcrumbTrail :crumbs="crumbs" />

    <div v-if="!campaign || !arc" class="surface p-8 text-center">
      <h2 class="text-xl font-display text-ink-900">Not found</h2>
      <RouterLink to="/campaigns" class="link mt-3 inline-block">Back</RouterLink>
    </div>

    <template v-else>
      <PageHeader :title="`Editing: ${arc.title}`" />
      <SurfaceCard>
        <ArcForm
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
