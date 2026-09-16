<script setup lang="ts">
import { computed, ref } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'

import type { CampaignId } from '@core/ids'
import type { SessionDraftInput } from '@core/models/session'

import { useCampaignStore } from '@features/campaigns/store'
import { useSessionStore } from '../store'
import SessionForm from '../components/SessionForm.vue'

import BreadcrumbTrail from '@ui/primitives/BreadcrumbTrail.vue'
import PageHeader from '@ui/primitives/PageHeader.vue'
import SurfaceCard from '@ui/primitives/SurfaceCard.vue'

const route = useRoute()
const router = useRouter()
const campaigns = useCampaignStore()
const sessions = useSessionStore()

const campaignIdFromRoute = computed(() => route.params.campaignId as string)
const campaign = computed(() => campaigns.all.find((c) => c.id === campaignIdFromRoute.value))

const busy = ref(false)
const lastError = ref<string | null>(null)

const crumbs = computed(() => [
  { to: '/', label: 'Home' },
  { to: '/campaigns', label: 'Campaigns' },
  {
    to: campaign.value ? `/campaigns/${campaign.value.id}` : '/campaigns',
    label: campaign.value?.name ?? 'Unknown',
  },
  {
    to: campaign.value ? `/campaigns/${campaign.value.id}/sessions` : '/campaigns',
    label: 'Sessions',
  },
  { label: 'New' },
])

async function submit(draft: SessionDraftInput): Promise<void> {
  if (!campaign.value) return
  busy.value = true
  lastError.value = null
  try {
    const created = sessions.create({
      ...draft,
      campaignId: campaign.value.id as CampaignId,
    })
    // Also update the active campaign tracking
    campaigns.recordSession(campaign.value.id as CampaignId, created.playedAt)
    await router.push(`/campaigns/${campaign.value.id}/sessions/${created.id}`)
  } catch (err) {
    lastError.value = err instanceof Error ? err.message : 'something went wrong'
  } finally {
    busy.value = false
  }
}

function cancel(): void {
  if (campaign.value) router.push(`/campaigns/${campaign.value.id}/sessions`)
  else router.push('/campaigns')
}
</script>

<template>
  <section class="container-wide py-8 max-w-3xl space-y-6">
    <BreadcrumbTrail :crumbs="crumbs" />

    <div v-if="!campaign" class="surface p-8 text-center">
      <h2 class="text-xl font-display text-ink-900">Campaign not found</h2>
      <RouterLink to="/campaigns" class="link mt-3 inline-block">Back</RouterLink>
    </div>

    <template v-else>
      <PageHeader title="Log a session" subtitle="Doesn't have to be much; even a sentence helps." />
      <SurfaceCard>
        <SessionForm
          :campaign-id="campaign.id as CampaignId"
          :busy="busy"
          submit-label="Save session"
          cancel-label="Back"
          @submit="submit"
          @cancel="cancel"
        />
        <p v-if="lastError" class="mt-3 text-sm text-crimson-600">{{ lastError }}</p>
      </SurfaceCard>
    </template>
  </section>
</template>
