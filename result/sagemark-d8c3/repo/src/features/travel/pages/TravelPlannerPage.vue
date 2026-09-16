<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute } from 'vue-router'

import { buildSeededRng } from '@core/dice/roll'
import type { CampaignId } from '@core/ids'
import type { JourneyLeg, JourneyParty } from '@core/rules/journey'
import {
  CLIMATES,
  SEASONS,
  TRAVEL_PACES,
  type Climate,
  type Season,
  type TravelPace,
  type WeatherOption,
  estimateTravel,
  paceDescription,
  rollWeather,
  severityTone,
  weatherOptions,
} from '@core/rules/weather'

import { useCampaignStore } from '@features/campaigns/store'

import JourneyLog from '../components/JourneyLog.vue'
import { emptyRoute, useTravelStore } from '../store'

import BaseButton from '@ui/primitives/BaseButton.vue'
import BreadcrumbTrail from '@ui/primitives/BreadcrumbTrail.vue'
import PageHeader from '@ui/primitives/PageHeader.vue'
import StatusBadge from '@ui/primitives/StatusBadge.vue'
import SurfaceCard from '@ui/primitives/SurfaceCard.vue'

const route = useRoute()
const campaigns = useCampaignStore()
const travel = useTravelStore()

const campaignIdFromRoute = computed(() => route.params.campaignId as string)
const campaign = computed(() => campaigns.all.find((c) => c.id === campaignIdFromRoute.value))

const climate = ref<Climate>('temperate')
const season = ref<Season>('autumn')
const pace = ref<TravelPace>('normal')
const miles = ref<number>(60)
const baseMilesPerDay = ref<number>(24)
const seed = ref<number>(Math.floor(Math.random() * 1_000_000))

const weather = computed<WeatherOption>(() =>
  rollWeather(climate.value, season.value, buildSeededRng(seed.value)),
)

const estimate = computed(() =>
  estimateTravel({
    miles: miles.value,
    baseMilesPerDay: baseMilesPerDay.value,
    pace: pace.value,
    weather: weather.value,
  }),
)

const tableForRegion = computed(() => weatherOptions(climate.value, season.value))

function rerollWeather(): void {
  seed.value = Math.floor(Math.random() * 1_000_000)
}

const campaignKey = computed(() => (campaign.value ? (campaign.value.id as CampaignId) : null))

const storedRoute = computed(() => (campaignKey.value ? travel.routeFor(campaignKey.value) : emptyRoute()))

const journey = computed(() => (campaignKey.value ? travel.walk(campaignKey.value) : null))

const routeCostMiles = computed(() => (campaignKey.value ? travel.cost(campaignKey.value) : 0))

function addLeg(): void {
  if (!campaignKey.value) return
  travel.addLeg(campaignKey.value, { climate: climate.value, season: season.value, pace: pace.value })
}

function dropLeg(index: number): void {
  if (!campaignKey.value) return
  travel.removeLeg(campaignKey.value, index)
}

function editLeg(index: number, patch: Partial<JourneyLeg>): void {
  if (!campaignKey.value) return
  travel.updateLeg(campaignKey.value, index, patch)
}

function editParty(patch: Partial<JourneyParty>): void {
  if (!campaignKey.value) return
  travel.setParty(campaignKey.value, patch)
}

function rerollJourney(): void {
  if (!campaignKey.value) return
  travel.reroll(campaignKey.value)
}

const crumbs = computed(() => [
  { to: '/', label: 'Home' },
  { to: '/campaigns', label: 'Campaigns' },
  {
    to: campaign.value ? `/campaigns/${campaign.value.id}` : '/campaigns',
    label: campaign.value?.name ?? 'Unknown',
  },
  { label: 'Travel' },
])
</script>

<template>
  <section class="container-wide py-8 space-y-6 max-w-3xl">
    <BreadcrumbTrail :crumbs="crumbs" />

    <div v-if="!campaign" class="surface p-8 text-center">
      <h2 class="text-xl font-display text-ink-900">Campaign not found</h2>
    </div>

    <template v-else>
      <PageHeader
        title="Travel planner"
        subtitle="Pick a climate, a season, a pace, a distance and let the weather decide the rest."
      />

      <SurfaceCard title="Plan">
        <form class="grid grid-cols-1 sm:grid-cols-4 gap-3" @submit.prevent>
          <label class="text-xs text-ink-500">
            Climate
            <select
              id="travel-climate"
              v-model="climate"
              class="mt-1 w-full border border-parchment-300 rounded-soft px-2 py-1 text-sm bg-white"
            >
              <option v-for="c in CLIMATES" :key="c" :value="c">{{ c }}</option>
            </select>
          </label>
          <label class="text-xs text-ink-500">
            Season
            <select
              id="travel-season"
              v-model="season"
              class="mt-1 w-full border border-parchment-300 rounded-soft px-2 py-1 text-sm bg-white"
            >
              <option v-for="s in SEASONS" :key="s" :value="s">{{ s }}</option>
            </select>
          </label>
          <label class="text-xs text-ink-500">
            Pace
            <select
              id="travel-pace"
              v-model="pace"
              class="mt-1 w-full border border-parchment-300 rounded-soft px-2 py-1 text-sm bg-white"
            >
              <option v-for="p in TRAVEL_PACES" :key="p" :value="p">{{ p }}</option>
            </select>
          </label>
          <label class="text-xs text-ink-500">
            Miles
            <input
              id="travel-miles"
              v-model.number="miles"
              type="number"
              min="1"
              max="2000"
              class="mt-1 w-full border border-parchment-300 rounded-soft px-2 py-1 text-sm bg-white"
            />
          </label>
          <label class="text-xs text-ink-500 sm:col-span-2">
            Base miles per day
            <input
              v-model.number="baseMilesPerDay"
              type="number"
              min="1"
              max="80"
              class="mt-1 w-full border border-parchment-300 rounded-soft px-2 py-1 text-sm bg-white"
            />
          </label>
          <div class="sm:col-span-2 flex items-end gap-2 justify-end">
            <BaseButton size="sm" @click="rerollWeather">reroll weather</BaseButton>
          </div>
        </form>
        <p class="mt-2 text-xs text-ink-500">{{ paceDescription(pace) }}</p>
      </SurfaceCard>

      <SurfaceCard title="Today's weather">
        <div class="flex flex-wrap items-center gap-2">
          <StatusBadge :tone="severityTone(weather.severity)" :soft="false">
            {{ weather.severity }}
          </StatusBadge>
          <span class="font-display text-lg text-ink-900">{{ weather.label }}</span>
          <span class="ml-auto text-xs text-ink-500">penalty {{ estimate.totalPenalty }}%</span>
        </div>
        <p class="mt-2 text-sm text-ink-600">{{ weather.note }}</p>
      </SurfaceCard>

      <SurfaceCard title="Estimate">
        <dl class="grid grid-cols-3 gap-3 text-sm">
          <div>
            <dt class="text-xs text-ink-500">Effective pace</dt>
            <dd class="text-ink-800 font-mono">{{ estimate.effectiveMilesPerDay }} mi/day</dd>
          </div>
          <div>
            <dt class="text-xs text-ink-500">Travel time</dt>
            <dd class="text-ink-800 font-mono">{{ estimate.days }} days</dd>
          </div>
          <div>
            <dt class="text-xs text-ink-500">Distance</dt>
            <dd class="text-ink-800 font-mono">{{ miles }} mi</dd>
          </div>
        </dl>
      </SurfaceCard>

      <SurfaceCard title="The road ahead" hint="Legs walked in order, one weather roll a day">
        <div class="flex flex-wrap items-end gap-3 mb-3 text-xs text-ink-500">
          <label>
            Party
            <input
              :value="storedRoute.party.size"
              type="number"
              min="1"
              max="20"
              class="mt-1 w-20 border border-parchment-300 rounded-soft px-2 py-1 text-sm bg-white"
              @change="editParty({ size: Number(($event.target as HTMLInputElement).value) })"
            />
          </label>
          <label>
            Open road mi/day
            <input
              :value="storedRoute.party.milesPerDay"
              type="number"
              min="1"
              max="80"
              class="mt-1 w-24 border border-parchment-300 rounded-soft px-2 py-1 text-sm bg-white"
              @change="editParty({ milesPerDay: Number(($event.target as HTMLInputElement).value) })"
            />
          </label>
          <label>
            Rations
            <input
              :value="storedRoute.party.rations"
              type="number"
              min="0"
              max="500"
              class="mt-1 w-24 border border-parchment-300 rounded-soft px-2 py-1 text-sm bg-white"
              @change="editParty({ rations: Number(($event.target as HTMLInputElement).value) })"
            />
          </label>
          <span class="ml-auto">route costs {{ routeCostMiles }} mi of open road</span>
          <BaseButton size="sm" @click="addLeg">add leg</BaseButton>
          <BaseButton size="sm" @click="rerollJourney">reroll skies</BaseButton>
        </div>

        <ul class="space-y-2">
          <li
            v-for="(leg, i) in storedRoute.legs"
            :key="i"
            class="flex flex-wrap items-center gap-2 text-sm border-t border-parchment-200 pt-2"
          >
            <input
              :value="leg.name"
              class="border border-parchment-300 rounded-soft px-2 py-1 bg-white w-40"
              @change="editLeg(i, { name: ($event.target as HTMLInputElement).value })"
            />
            <input
              :value="leg.miles"
              type="number"
              min="0"
              class="border border-parchment-300 rounded-soft px-2 py-1 bg-white w-24"
              @change="editLeg(i, { miles: Number(($event.target as HTMLInputElement).value) })"
            />
            <input
              :value="leg.costPerMile"
              type="number"
              min="0.1"
              step="0.1"
              class="border border-parchment-300 rounded-soft px-2 py-1 bg-white w-24"
              @change="editLeg(i, { costPerMile: Number(($event.target as HTMLInputElement).value) })"
            />
            <select
              :value="leg.pace"
              class="border border-parchment-300 rounded-soft px-2 py-1 bg-white"
              @change="editLeg(i, { pace: ($event.target as HTMLSelectElement).value as TravelPace })"
            >
              <option v-for="p in TRAVEL_PACES" :key="p" :value="p">{{ p }}</option>
            </select>
            <BaseButton size="sm" @click="dropLeg(i)">drop</BaseButton>
          </li>
        </ul>
      </SurfaceCard>

      <SurfaceCard v-if="journey" title="Day by day">
        <JourneyLog :report="journey" :mouths="storedRoute.party.size" />
      </SurfaceCard>

      <SurfaceCard title="What you might see this stretch" hint="The table you are rolling on">
        <ul class="text-sm space-y-1">
          <li v-for="opt in tableForRegion" :key="opt.label" class="flex items-center gap-2">
            <StatusBadge :tone="severityTone(opt.severity)">{{ opt.severity }}</StatusBadge>
            <span>{{ opt.label }}</span>
            <span class="ml-auto text-xs text-ink-500">weight {{ opt.weight }}</span>
          </li>
        </ul>
      </SurfaceCard>
    </template>
  </section>
</template>
