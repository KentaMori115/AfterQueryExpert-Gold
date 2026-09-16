<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { RouterLink, useRoute } from 'vue-router'

import type { CampaignId, TimelineEventId } from '@core/ids'
import {
  TIMELINE_ERAS,
  TIMELINE_SIGNIFICANCES,
  eraLabel,
  formatInWorldDate,
  significanceLabel,
  significanceWeight,
} from '@core/models/timeline'

import { useCampaignStore } from '@features/campaigns/store'
import { useSettingsStore } from '@features/settings/store'
import { useTimelineStore } from '../store'
import CalendarWidget from '@features/calendar/components/CalendarWidget.vue'
import type { CalendarMarkedEvent } from '@features/calendar/types'

import BaseButton from '@ui/primitives/BaseButton.vue'
import BreadcrumbTrail from '@ui/primitives/BreadcrumbTrail.vue'
import EmptyState from '@ui/primitives/EmptyState.vue'
import PageHeader from '@ui/primitives/PageHeader.vue'
import StatusBadge from '@ui/primitives/StatusBadge.vue'
import SurfaceCard from '@ui/primitives/SurfaceCard.vue'

const route = useRoute()
const campaigns = useCampaignStore()
const timeline = useTimelineStore()

const campaignIdFromRoute = computed(() => route.params.campaignId as string)
const campaign = computed(() => campaigns.all.find((c) => c.id === campaignIdFromRoute.value))

const events = computed(() =>
  campaign.value ? timeline.chronologicalFor(campaign.value.id as CampaignId) : [],
)

const settings = useSettingsStore()
const calendarShape = computed(() => ({
  monthsPerYear: settings.calendar.monthsPerYear,
  daysPerMonth: settings.calendar.daysPerMonth,
}))
const calendarSuffix = computed(() => settings.calendar.yearSuffix)
const calendarMarkedEvents = computed<CalendarMarkedEvent[]>(() =>
  events.value
    .filter((ev) => ev.date.month && ev.date.day)
    .map((ev) => ({
      date: { year: ev.date.year, month: ev.date.month ?? 1, day: ev.date.day ?? 1 },
      label: ev.title,
      tone: ev.significance === 'world-shifting' ? 'danger' : ev.significance === 'major' ? 'warning' : 'info',
    })),
)
const calendarToday = computed(() => {
  const ordered = [...events.value].reverse()
  for (const ev of ordered) {
    if (ev.date.month && ev.date.day) {
      return { year: ev.date.year, month: ev.date.month ?? 1, day: ev.date.day ?? 1 }
    }
  }
  return null
})

const draft = reactive<{
  title: string
  description: string
  year: number
  month: number | null
  day: number | null
  era: (typeof TIMELINE_ERAS)[number]
  significance: (typeof TIMELINE_SIGNIFICANCES)[number]
  revealed: boolean
}>({
  title: '',
  description: '',
  year: 1234,
  month: null,
  day: null,
  era: 'present',
  significance: 'notable',
  revealed: false,
})

const lastError = ref<string | null>(null)

const crumbs = computed(() => [
  { to: '/', label: 'Home' },
  { to: '/campaigns', label: 'Campaigns' },
  {
    to: campaign.value ? `/campaigns/${campaign.value.id}` : '/campaigns',
    label: campaign.value?.name ?? 'Unknown',
  },
  { label: 'Timeline' },
])

function addEvent(): void {
  if (!campaign.value) return
  try {
    timeline.create({
      campaignId: campaign.value.id,
      title: draft.title,
      description: draft.description,
      date: {
        year: Number(draft.year),
        month: draft.month ? Number(draft.month) : null,
        day: draft.day ? Number(draft.day) : null,
      },
      era: draft.era,
      significance: draft.significance,
      revealed: draft.revealed,
    })
    draft.title = ''
    draft.description = ''
    lastError.value = null
  } catch (err) {
    lastError.value = err instanceof Error ? err.message : 'something went wrong'
  }
}

function toggleReveal(id: TimelineEventId, revealed: boolean): void {
  timeline.setRevealed(id, !revealed)
}

function deleteEvent(id: TimelineEventId): void {
  if (!window.confirm('Delete this event?')) return
  timeline.remove(id)
}

function badgeTone(weight: number): 'neutral' | 'info' | 'warning' | 'danger' {
  if (weight >= 4) return 'danger'
  if (weight >= 3) return 'warning'
  if (weight >= 2) return 'info'
  return 'neutral'
}
</script>

<template>
  <section class="container-wide py-8 space-y-6">
    <BreadcrumbTrail :crumbs="crumbs" />

    <div v-if="!campaign" class="surface p-8 text-center">
      <h2 class="text-xl font-display text-ink-900">Campaign not found</h2>
      <RouterLink to="/campaigns" class="link mt-3 inline-block">Back</RouterLink>
    </div>

    <template v-else>
      <PageHeader title="Timeline" :meta="events.length + ' events'" />

      <SurfaceCard title="Calendar view" hint="Dotted days have events">
        <CalendarWidget
          :shape="calendarShape"
          :today="calendarToday"
          :events="calendarMarkedEvents"
          :year-suffix="calendarSuffix"
        />
      </SurfaceCard>

      <SurfaceCard title="Add an event">
        <form class="grid grid-cols-2 sm:grid-cols-4 gap-3" @submit.prevent="addEvent">
          <input
            id="event-title"
            v-model="draft.title"
            type="text"
            placeholder="Title"
            class="col-span-2 sm:col-span-4 border border-parchment-300 rounded-soft px-3 py-2 text-sm bg-white"
          />
          <input
            v-model.number="draft.year"
            type="number"
            placeholder="Year"
            class="border border-parchment-300 rounded-soft px-3 py-2 text-sm bg-white"
          />
          <input
            v-model.number="draft.month"
            type="number"
            min="1"
            max="13"
            placeholder="Month"
            class="border border-parchment-300 rounded-soft px-3 py-2 text-sm bg-white"
          />
          <input
            v-model.number="draft.day"
            type="number"
            min="1"
            max="31"
            placeholder="Day"
            class="border border-parchment-300 rounded-soft px-3 py-2 text-sm bg-white"
          />
          <select v-model="draft.era" class="border border-parchment-300 rounded-soft px-3 py-2 text-sm bg-white">
            <option v-for="e in TIMELINE_ERAS" :key="e" :value="e">{{ eraLabel(e) }}</option>
          </select>
          <select v-model="draft.significance" class="col-span-2 border border-parchment-300 rounded-soft px-3 py-2 text-sm bg-white">
            <option v-for="s in TIMELINE_SIGNIFICANCES" :key="s" :value="s">{{ significanceLabel(s) }}</option>
          </select>
          <label class="col-span-2 flex items-center gap-2 text-sm text-ink-700">
            <input v-model="draft.revealed" type="checkbox" />
            Revealed to the party
          </label>
          <textarea
            v-model="draft.description"
            rows="2"
            placeholder="Description"
            class="col-span-2 sm:col-span-4 border border-parchment-300 rounded-soft px-3 py-2 text-sm bg-white"
          />
          <div class="col-span-2 sm:col-span-4 flex justify-end">
            <BaseButton tone="primary" type="submit">Add event</BaseButton>
          </div>
        </form>
        <p v-if="lastError" class="mt-2 text-sm text-crimson-600">{{ lastError }}</p>
      </SurfaceCard>

      <EmptyState
        v-if="events.length === 0"
        title="No events recorded"
        description="Add anchor points so future sessions can hang off them."
      />
      <ul v-else class="space-y-3">
        <li v-for="ev in events" :key="ev.id" class="surface p-3">
          <header class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <h3 class="text-base font-display text-ink-900">{{ ev.title }}</h3>
              <p class="text-xs text-ink-500">
                {{ formatInWorldDate(ev.date) }} - {{ eraLabel(ev.era) }}
              </p>
            </div>
            <div class="flex gap-2">
              <StatusBadge :tone="badgeTone(significanceWeight(ev.significance))">
                {{ significanceLabel(ev.significance) }}
              </StatusBadge>
              <StatusBadge v-if="ev.revealed" tone="success">Revealed</StatusBadge>
              <StatusBadge v-else tone="neutral">Hidden</StatusBadge>
            </div>
          </header>
          <p v-if="ev.description" class="mt-2 text-sm text-ink-700 whitespace-pre-line">
            {{ ev.description }}
          </p>
          <footer class="mt-3 flex gap-2 text-xs">
            <button class="text-ink-700 hover:text-ink-900" @click="toggleReveal(ev.id, ev.revealed)">
              {{ ev.revealed ? 'unreveal' : 'reveal' }}
            </button>
            <button class="ml-auto text-crimson-600 hover:text-crimson-800" @click="deleteEvent(ev.id)">
              delete
            </button>
          </footer>
        </li>
      </ul>
    </template>
  </section>
</template>
