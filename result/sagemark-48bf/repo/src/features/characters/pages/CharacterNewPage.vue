<script setup lang="ts">
import { computed, ref } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'

import type { CampaignId } from '@core/ids'
import type { CharacterDraftInput } from '@core/models/character'

import { useCampaignStore } from '@features/campaigns/store'
import { useCharacterStore } from '../store'
import CharacterForm from '../components/CharacterForm.vue'

import BreadcrumbTrail from '@ui/primitives/BreadcrumbTrail.vue'
import PageHeader from '@ui/primitives/PageHeader.vue'
import SurfaceCard from '@ui/primitives/SurfaceCard.vue'

const route = useRoute()
const router = useRouter()
const campaigns = useCampaignStore()
const characters = useCharacterStore()

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
    to: campaign.value ? `/campaigns/${campaign.value.id}/characters` : '/campaigns',
    label: 'Cast',
  },
  { label: 'New' },
])

async function submit(draft: CharacterDraftInput): Promise<void> {
  if (!campaign.value) return
  busy.value = true
  lastError.value = null
  try {
    const created = characters.create({
      ...draft,
      campaignId: campaign.value.id as CampaignId,
    })
    await router.push(`/campaigns/${campaign.value.id}/characters/${created.id}`)
  } catch (err) {
    lastError.value = err instanceof Error ? err.message : 'something went wrong'
  } finally {
    busy.value = false
  }
}

function cancel(): void {
  if (campaign.value) router.push(`/campaigns/${campaign.value.id}/characters`)
  else router.push('/campaigns')
}
</script>

<template>
  <section class="container-wide py-8 max-w-3xl space-y-6">
    <BreadcrumbTrail :crumbs="crumbs" />

    <div v-if="!campaign" class="surface p-8 text-center">
      <h2 class="text-xl font-display text-ink-900">Campaign not found</h2>
      <RouterLink to="/campaigns" class="link mt-3 inline-block">Back to campaigns</RouterLink>
    </div>

    <template v-else>
      <PageHeader title="New character" subtitle="One entry now saves a lot of fumbling at the table later." />
      <SurfaceCard>
        <CharacterForm
          :campaign-id="campaign.id as CampaignId"
          :busy="busy"
          submit-label="Create"
          cancel-label="Back"
          @submit="submit"
          @cancel="cancel"
        />
        <p v-if="lastError" class="mt-3 text-sm text-crimson-600">{{ lastError }}</p>
      </SurfaceCard>
    </template>
  </section>
</template>
