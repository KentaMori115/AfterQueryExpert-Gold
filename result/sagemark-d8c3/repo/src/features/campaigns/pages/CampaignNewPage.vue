<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'

import type { CampaignDraftInput } from '@core/models/campaign'
import { useCampaignStore } from '../store'
import CampaignForm from '../components/CampaignForm.vue'
import PageHeader from '@ui/primitives/PageHeader.vue'
import SurfaceCard from '@ui/primitives/SurfaceCard.vue'

const store = useCampaignStore()
const router = useRouter()
const busy = ref(false)
const lastError = ref<string | null>(null)

async function submit(draft: CampaignDraftInput): Promise<void> {
  busy.value = true
  lastError.value = null
  try {
    const created = store.create(draft)
    store.setActive(created.id)
    await router.push('/campaigns')
  } catch (err) {
    lastError.value = err instanceof Error ? err.message : 'something went wrong'
  } finally {
    busy.value = false
  }
}

function cancel(): void {
  router.push('/campaigns')
}
</script>

<template>
  <section class="container-wide py-8 max-w-2xl space-y-6">
    <PageHeader title="New campaign" subtitle="A few details now keep things tidy for the rest of the run." />
    <SurfaceCard>
      <CampaignForm
        :busy="busy"
        submit-label="Create campaign"
        cancel-label="Back to list"
        @submit="submit"
        @cancel="cancel"
      />
      <p v-if="lastError" class="mt-3 text-sm text-crimson-600">{{ lastError }}</p>
    </SurfaceCard>
  </section>
</template>
