<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { buildSeededRng } from '@core/dice/roll'
import type { CampaignId } from '@core/ids'
import type { NpcSeed } from '@core/generators/npc-tables'
import {
  generateRumor,
  generateStreetName,
  generateTavernName,
  type RumorSeed,
} from '@core/generators/place-tables'

import { useCampaignStore } from '@features/campaigns/store'
import { useCharacterStore } from '@features/characters/store'
import { useLocationStore } from '@features/locations/store'

import BaseButton from '@ui/primitives/BaseButton.vue'
import BreadcrumbTrail from '@ui/primitives/BreadcrumbTrail.vue'
import PageHeader from '@ui/primitives/PageHeader.vue'
import SurfaceCard from '@ui/primitives/SurfaceCard.vue'

import NpcGenerator from '../components/NpcGenerator.vue'
import TrinketGenerator from '../components/TrinketGenerator.vue'
import ReactionRoller from '@features/reactions/components/ReactionRoller.vue'

const route = useRoute()
const router = useRouter()
const campaigns = useCampaignStore()
const characters = useCharacterStore()
const locations = useLocationStore()

const campaignIdFromRoute = computed(() => route.params.campaignId as string)
const campaign = computed(() => campaigns.all.find((c) => c.id === campaignIdFromRoute.value))

const tavernSeed = ref<number>(Math.floor(Math.random() * 1_000_000))
const streetSeed = ref<number>(Math.floor(Math.random() * 1_000_000))
const rumorSeed = ref<number>(Math.floor(Math.random() * 1_000_000))

const placeNames = computed<string[]>(() =>
  campaign.value
    ? locations.forCampaign(campaign.value.id as CampaignId).map((p) => p.name)
    : [],
)

const tavernName = computed(() => generateTavernName(buildSeededRng(tavernSeed.value)).name)
const streetName = computed(() => generateStreetName(buildSeededRng(streetSeed.value)).name)
const rumor = computed<RumorSeed>(() =>
  generateRumor(buildSeededRng(rumorSeed.value), placeNames.value),
)

const crumbs = computed(() => [
  { to: '/', label: 'Home' },
  { to: '/campaigns', label: 'Campaigns' },
  {
    to: campaign.value ? `/campaigns/${campaign.value.id}` : '/campaigns',
    label: campaign.value?.name ?? 'Unknown',
  },
  { label: 'Generators' },
])

function rerollTavern(): void {
  tavernSeed.value = Math.floor(Math.random() * 1_000_000)
}
function rerollStreet(): void {
  streetSeed.value = Math.floor(Math.random() * 1_000_000)
}
function rerollRumor(): void {
  rumorSeed.value = Math.floor(Math.random() * 1_000_000)
}

function adoptNpc(seed: NpcSeed): void {
  if (!campaign.value) return
  const created = characters.create({
    campaignId: campaign.value.id as CampaignId,
    name: seed.name,
    kind: 'npc',
    blurb: `${seed.vocation}\nQuirk: ${seed.quirk}\nWants: ${seed.motivation}`,
    disposition: 'neutral',
  })
  router.push(`/campaigns/${campaign.value.id}/characters/${created.id}`)
}
</script>

<template>
  <section class="container-wide py-8 space-y-6 max-w-3xl">
    <BreadcrumbTrail :crumbs="crumbs" />

    <div v-if="!campaign" class="surface p-8 text-center">
      <h2 class="text-xl font-display text-ink-900">Campaign not found</h2>
    </div>

    <template v-else>
      <PageHeader
        title="Generators"
        subtitle="Spin up a stranger, a tavern, a street or a fresh rumor."
      />

      <SurfaceCard title="Quick NPC" hint="Adopt to add to the cast">
        <NpcGenerator @adopt="adoptNpc" />
      </SurfaceCard>

      <SurfaceCard title="Reaction and morale" hint="2d6 against the classic bands">
        <ReactionRoller />
      </SurfaceCard>

      <SurfaceCard title="Tavern name">
        <div class="flex flex-wrap items-center gap-3">
          <span class="font-display text-lg text-ink-900">{{ tavernName }}</span>
          <BaseButton size="sm" @click="rerollTavern">reroll</BaseButton>
        </div>
      </SurfaceCard>

      <SurfaceCard title="Street name">
        <div class="flex flex-wrap items-center gap-3">
          <span class="font-display text-lg text-ink-900">{{ streetName }}</span>
          <BaseButton size="sm" @click="rerollStreet">reroll</BaseButton>
        </div>
      </SurfaceCard>

      <SurfaceCard title="Pocket trinkets" hint="Flavor items the cast might find">
        <TrinketGenerator />
      </SurfaceCard>

      <SurfaceCard title="Rumor" hint="Pulled from your campaign places when possible">
        <p class="text-sm text-ink-700">{{ rumor.text }}</p>
        <div class="mt-2 flex flex-wrap items-center gap-3 text-xs">
          <span class="text-ink-500">Place: {{ rumor.place }}</span>
          <BaseButton size="sm" @click="rerollRumor">reroll</BaseButton>
        </div>
      </SurfaceCard>
    </template>
  </section>
</template>
