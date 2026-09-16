<script setup lang="ts">
import { computed, ref } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'

import type { CampaignId, CharacterId } from '@core/ids'
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
const charIdFromRoute = computed(() => route.params.id as string)

const campaign = computed(() => campaigns.all.find((c) => c.id === campaignIdFromRoute.value))
const character = computed(() => characters.byId(charIdFromRoute.value as CharacterId))

const busy = ref(false)
const lastError = ref<string | null>(null)

const initial = computed<Partial<CharacterDraftInput>>(() => {
  const c = character.value
  if (!c) return {}
  return {
    campaignId: c.campaignId,
    kind: c.kind,
    name: c.name,
    pronouns: c.pronouns,
    ancestry: c.ancestry,
    vocation: c.vocation,
    level: c.level,
    disposition: c.disposition,
    blurb: c.blurb,
    alive: c.alive,
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
    to: campaign.value ? `/campaigns/${campaign.value.id}/characters` : '/campaigns',
    label: 'Cast',
  },
  {
    to: character.value && campaign.value
      ? `/campaigns/${campaign.value.id}/characters/${character.value.id}`
      : '/campaigns',
    label: character.value?.name ?? 'Unknown',
  },
  { label: 'Edit' },
])

async function submit(draft: CharacterDraftInput): Promise<void> {
  if (!character.value || !campaign.value) return
  busy.value = true
  lastError.value = null
  try {
    characters.update(character.value.id as CharacterId, draft)
    await router.push(`/campaigns/${campaign.value.id}/characters/${character.value.id}`)
  } catch (err) {
    lastError.value = err instanceof Error ? err.message : 'something went wrong'
  } finally {
    busy.value = false
  }
}

function cancel(): void {
  if (campaign.value && character.value)
    router.push(`/campaigns/${campaign.value.id}/characters/${character.value.id}`)
  else router.push('/campaigns')
}
</script>

<template>
  <section class="container-wide py-8 max-w-3xl space-y-6">
    <BreadcrumbTrail :crumbs="crumbs" />

    <div v-if="!campaign || !character" class="surface p-8 text-center">
      <h2 class="text-xl font-display text-ink-900">Not found</h2>
      <RouterLink to="/campaigns" class="link mt-3 inline-block">Back to campaigns</RouterLink>
    </div>

    <template v-else>
      <PageHeader :title="`Editing: ${character.name}`" subtitle="Notes are free-form; the rest is structured." />
      <SurfaceCard>
        <CharacterForm
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
