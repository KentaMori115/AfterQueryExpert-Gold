<script setup lang="ts">
import { computed, ref } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'

import type { CampaignDraftInput } from '@core/models/campaign'
import type { CampaignId } from '@core/ids'

import { useCampaignStore } from '../store'
import CampaignForm from '../components/CampaignForm.vue'
import BreadcrumbTrail from '@ui/primitives/BreadcrumbTrail.vue'
import PageHeader from '@ui/primitives/PageHeader.vue'
import SurfaceCard from '@ui/primitives/SurfaceCard.vue'

const route = useRoute()
const router = useRouter()
const store = useCampaignStore()

const idFromRoute = computed(() => route.params.id as string)
const campaign = computed(() => store.all.find((c) => c.id === idFromRoute.value))

const busy = ref(false)
const lastError = ref<string | null>(null)

const initial = computed<CampaignDraftInput>(() => {
  const c = campaign.value
  if (!c) return { name: '' }
  return { name: c.name, tagline: c.tagline, system: c.system, status: c.status }
})

const crumbs = computed(() => [
  { to: '/', label: 'Home' },
  { to: '/campaigns', label: 'Campaigns' },
  { to: campaign.value ? `/campaigns/${campaign.value.id}` : '/campaigns', label: campaign.value?.name ?? 'Unknown' },
  { label: 'Edit' },
])

async function submit(draft: CampaignDraftInput): Promise<void> {
  if (!campaign.value) return
  busy.value = true
  lastError.value = null
  try {
    store.update(campaign.value.id as CampaignId, draft)
    await router.push(`/campaigns/${campaign.value.id}`)
  } catch (err) {
    lastError.value = err instanceof Error ? err.message : 'something went wrong'
  } finally {
    busy.value = false
  }
}

function cancel(): void {
  if (campaign.value) router.push(`/campaigns/${campaign.value.id}`)
  else router.push('/campaigns')
}
</script>

<template>
  <section class="container-wide py-8 max-w-2xl space-y-6">
    <BreadcrumbTrail :crumbs="crumbs" />

    <div v-if="!campaign" class="surface p-8 text-center">
      <h2 class="text-xl font-display text-ink-900">Campaign not found</h2>
      <p class="text-ink-500 mt-1">It may have been deleted, or the link is wrong.</p>
      <RouterLink to="/campaigns" class="link mt-3 inline-block">Back to all campaigns</RouterLink>
    </div>

    <template v-else>
      <PageHeader :title="`Editing: ${campaign.name}`" subtitle="Change anything you like; we keep history of the timestamps." />
      <SurfaceCard>
        <CampaignForm
          :initial="initial"
          :busy="busy"
          submit-label="Save changes"
          cancel-label="Discard"
          @submit="submit"
          @cancel="cancel"
        />
        <p v-if="lastError" class="mt-3 text-sm text-crimson-600">{{ lastError }}</p>
      </SurfaceCard>
    </template>
  </section>
</template>
