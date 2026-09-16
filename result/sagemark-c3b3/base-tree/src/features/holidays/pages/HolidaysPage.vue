<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { useRoute } from 'vue-router'

import type { CampaignId } from '@core/ids'
import {
  HOLIDAY_KINDS,
  type HolidayKind,
  holidayKindLabel,
  holidayKindTone,
} from '@core/models/holiday'

import { useCampaignStore } from '@features/campaigns/store'
import { useSettingsStore } from '@features/settings/store'

import BaseButton from '@ui/primitives/BaseButton.vue'
import BreadcrumbTrail from '@ui/primitives/BreadcrumbTrail.vue'
import EmptyState from '@ui/primitives/EmptyState.vue'
import PageHeader from '@ui/primitives/PageHeader.vue'
import StatusBadge from '@ui/primitives/StatusBadge.vue'
import SurfaceCard from '@ui/primitives/SurfaceCard.vue'

import { useHolidayStore } from '../store'

const route = useRoute()
const campaigns = useCampaignStore()
const settings = useSettingsStore()
const holidays = useHolidayStore()

const campaignIdFromRoute = computed(() => route.params.campaignId as string)
const campaign = computed(() => campaigns.all.find((c) => c.id === campaignIdFromRoute.value))

const shape = computed(() => ({
  monthsPerYear: settings.calendar.monthsPerYear,
  daysPerMonth: settings.calendar.daysPerMonth,
}))

const all = computed(() => (campaign.value ? holidays.forCampaign(campaign.value.id as CampaignId) : []))

const todayCursor = reactive({ month: 1, day: 1 })

const upcoming = computed(() =>
  campaign.value
    ? holidays.upcoming(campaign.value.id as CampaignId, shape.value, todayCursor, 4)
    : [],
)

const draft = reactive({
  name: '',
  month: 1,
  day: 1,
  kind: 'civic' as HolidayKind,
  observance: '',
})

const lastError = ref<string | null>(null)

function addHoliday(): void {
  if (!campaign.value) return
  try {
    holidays.create({
      campaignId: campaign.value.id as CampaignId,
      name: draft.name,
      month: Number(draft.month),
      day: Number(draft.day),
      kind: draft.kind,
      observance: draft.observance,
    })
    draft.name = ''
    draft.observance = ''
    lastError.value = null
  } catch (err) {
    lastError.value = err instanceof Error ? err.message : 'failed'
  }
}

function deleteHoliday(id: string): void {
  if (!window.confirm('Forget this holiday?')) return
  holidays.remove(id)
}

const crumbs = computed(() => [
  { to: '/', label: 'Home' },
  { to: '/campaigns', label: 'Campaigns' },
  {
    to: campaign.value ? `/campaigns/${campaign.value.id}` : '/campaigns',
    label: campaign.value?.name ?? 'Unknown',
  },
  { label: 'Holidays' },
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
        title="Holidays"
        subtitle="Festivals, memorials and market days the calendar keeps."
        :meta="all.length + ' on the calendar'"
      />

      <SurfaceCard title="Upcoming" hint="Set today below to peek ahead">
        <div class="flex flex-wrap items-end gap-3 text-xs mb-3">
          <label class="text-ink-500">
            Cursor month
            <input
              id="cursor-month"
              v-model.number="todayCursor.month"
              type="number"
              min="1"
              :max="shape.monthsPerYear"
              class="mt-1 w-20 border border-parchment-300 rounded-soft px-2 py-1 bg-white"
            />
          </label>
          <label class="text-ink-500">
            Cursor day
            <input
              id="cursor-day"
              v-model.number="todayCursor.day"
              type="number"
              min="1"
              :max="shape.daysPerMonth"
              class="mt-1 w-20 border border-parchment-300 rounded-soft px-2 py-1 bg-white"
            />
          </label>
        </div>
        <EmptyState
          v-if="upcoming.length === 0"
          title="Nothing on the calendar"
          description="Add some holidays below and they will sort themselves."
        />
        <ul v-else class="space-y-1 text-sm">
          <li v-for="h in upcoming" :key="h.id" class="flex items-center gap-2">
            <span class="font-mono w-16">{{ h.month }} / {{ h.day }}</span>
            <StatusBadge :tone="holidayKindTone(h.kind)">{{ holidayKindLabel(h.kind) }}</StatusBadge>
            <span class="text-ink-800">{{ h.name }}</span>
          </li>
        </ul>
      </SurfaceCard>

      <SurfaceCard title="Add a holiday">
        <form class="grid grid-cols-2 sm:grid-cols-5 gap-2" @submit.prevent="addHoliday">
          <input
            id="hol-name"
            v-model="draft.name"
            type="text"
            placeholder="Frost Eve"
            class="sm:col-span-2 border border-parchment-300 rounded-soft px-2 py-1 text-sm bg-white"
          />
          <input
            v-model.number="draft.month"
            type="number"
            min="1"
            :max="shape.monthsPerYear"
            placeholder="month"
            class="border border-parchment-300 rounded-soft px-2 py-1 text-sm bg-white"
          />
          <input
            v-model.number="draft.day"
            type="number"
            min="1"
            :max="shape.daysPerMonth"
            placeholder="day"
            class="border border-parchment-300 rounded-soft px-2 py-1 text-sm bg-white"
          />
          <select
            v-model="draft.kind"
            class="border border-parchment-300 rounded-soft px-2 py-1 text-sm bg-white"
          >
            <option v-for="k in HOLIDAY_KINDS" :key="k" :value="k">{{ holidayKindLabel(k) }}</option>
          </select>
          <input
            v-model="draft.observance"
            type="text"
            placeholder="how it is observed"
            class="sm:col-span-4 border border-parchment-300 rounded-soft px-2 py-1 text-sm bg-white"
          />
          <BaseButton size="sm" tone="primary" type="submit">add</BaseButton>
        </form>
        <p v-if="lastError" class="mt-2 text-sm text-crimson-600">{{ lastError }}</p>
      </SurfaceCard>

      <EmptyState
        v-if="all.length === 0"
        title="No holidays yet"
        description="A campaign feels lived in once the calendar has a few feast days."
      />
      <ul v-else class="space-y-2">
        <li v-for="h in all" :key="h.id" class="surface p-3">
          <header class="flex flex-wrap items-center gap-2">
            <span class="font-mono w-16 text-ink-500">{{ h.month }} / {{ h.day }}</span>
            <span class="font-display text-ink-900">{{ h.name }}</span>
            <StatusBadge :tone="holidayKindTone(h.kind)">{{ holidayKindLabel(h.kind) }}</StatusBadge>
            <button
              type="button"
              class="ml-auto text-xs text-crimson-600 hover:text-crimson-800"
              @click="deleteHoliday(h.id)"
            >
              forget
            </button>
          </header>
          <p v-if="h.observance" class="text-sm text-ink-700 mt-1">{{ h.observance }}</p>
        </li>
      </ul>
    </template>
  </section>
</template>
