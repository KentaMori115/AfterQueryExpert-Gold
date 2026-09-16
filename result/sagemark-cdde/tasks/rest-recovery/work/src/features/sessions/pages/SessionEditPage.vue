<script setup lang="ts">
import { computed, ref } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'

import type { CampaignId, SessionId } from '@core/ids'
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
const sesIdFromRoute = computed(() => route.params.id as string)

const campaign = computed(() => campaigns.all.find((c) => c.id === campaignIdFromRoute.value))
const session = computed(() => sessions.byId(sesIdFromRoute.value as SessionId))

const busy = ref(false)
const lastError = ref<string | null>(null)

const initial = computed<Partial<SessionDraftInput>>(() => {
  const s = session.value
  if (!s) return {}
  return {
    campaignId: s.campaignId,
    title: s.title,
    playedAt: s.playedAt,
    durationMinutes: s.durationMinutes,
    locationId: s.locationId,
    summary: s.summary,
    log: s.log,
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
    to: campaign.value ? `/campaigns/${campaign.value.id}/sessions` : '/campaigns',
    label: 'Sessions',
  },
  {
    to: campaign.value && session.value
      ? `/campaigns/${campaign.value.id}/sessions/${session.value.id}`
      : '/campaigns',
    label: session.value?.title || 'Unknown',
  },
  { label: 'Edit' },
])

async function submit(draft: SessionDraftInput): Promise<void> {
  if (!session.value || !campaign.value) return
  busy.value = true
  lastError.value = null
  try {
    sessions.update(session.value.id as SessionId, draft)
    await router.push(`/campaigns/${campaign.value.id}/sessions/${session.value.id}`)
  } catch (err) {
    lastError.value = err instanceof Error ? err.message : 'something went wrong'
  } finally {
    busy.value = false
  }
}

function cancel(): void {
  if (campaign.value && session.value)
    router.push(`/campaigns/${campaign.value.id}/sessions/${session.value.id}`)
  else router.push('/campaigns')
}
</script>

<template>
  <section class="container-wide py-8 max-w-3xl space-y-6">
    <BreadcrumbTrail :crumbs="crumbs" />

    <div v-if="!campaign || !session" class="surface p-8 text-center">
      <h2 class="text-xl font-display text-ink-900">Not found</h2>
      <RouterLink to="/campaigns" class="link mt-3 inline-block">Back</RouterLink>
    </div>

    <template v-else>
      <PageHeader :title="`Editing: ${session.title}`" />
      <SurfaceCard>
        <SessionForm
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
