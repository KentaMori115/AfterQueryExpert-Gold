import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import { buildSeededRng } from '@core/dice/roll'
import type { CampaignId } from '@core/ids'
import type { CalendarDay, CalendarShape } from '@core/lib/inworld-calendar'
import { getStore } from '@core/persistence/storage'
import {
  type JourneyLeg,
  type JourneyParty,
  type JourneyReport,
  planJourney,
  routeCost,
} from '@core/rules/journey'
import type { Climate, Season, TravelPace } from '@core/rules/weather'

const STORAGE_KEY = 'travel:routes:v1'

export interface StoredRoute {
  legs: JourneyLeg[]
  party: JourneyParty
  start: CalendarDay
  calendar: CalendarShape
  seed: number
}

interface SerialState {
  byCampaign: Record<string, StoredRoute>
}

export function emptyRoute(): StoredRoute {
  return {
    legs: [],
    party: { size: 4, milesPerDay: 24, rations: 40, exhaustion: 0 },
    start: { year: 1, month: 1, day: 1 },
    calendar: { monthsPerYear: 12, daysPerMonth: 30 },
    seed: 1,
  }
}

function newLeg(): JourneyLeg {
  return {
    name: 'New leg',
    miles: 30,
    costPerMile: 1,
    climate: 'temperate',
    season: 'autumn',
    pace: 'normal',
  }
}

function load(): SerialState {
  const raw = getStore().get(STORAGE_KEY)
  if (!raw) return { byCampaign: {} }
  try {
    const parsed = JSON.parse(raw) as SerialState
    if (parsed && parsed.byCampaign) return parsed
  } catch {
    return { byCampaign: {} }
  }
  return { byCampaign: {} }
}

function persist(state: SerialState): void {
  getStore().set(STORAGE_KEY, JSON.stringify(state))
}

export const useTravelStore = defineStore('travel', () => {
  const state = ref<SerialState>(load())

  function routeFor(id: CampaignId): StoredRoute {
    return state.value.byCampaign[id] ?? emptyRoute()
  }

  function setRoute(id: CampaignId, route: StoredRoute): void {
    state.value = { byCampaign: { ...state.value.byCampaign, [id]: route } }
    persist(state.value)
  }

  function addLeg(id: CampaignId, leg: Partial<JourneyLeg> = {}): JourneyLeg {
    const route = routeFor(id)
    const added: JourneyLeg = { ...newLeg(), ...leg }
    setRoute(id, { ...route, legs: [...route.legs, added] })
    return added
  }

  function updateLeg(id: CampaignId, index: number, patch: Partial<JourneyLeg>): void {
    const route = routeFor(id)
    if (index < 0 || index >= route.legs.length) return
    const legs = route.legs.map((leg, i) => (i === index ? { ...leg, ...patch } : leg))
    setRoute(id, { ...route, legs })
  }

  function removeLeg(id: CampaignId, index: number): void {
    const route = routeFor(id)
    if (index < 0 || index >= route.legs.length) return
    setRoute(id, { ...route, legs: route.legs.filter((_, i) => i !== index) })
  }

  function setParty(id: CampaignId, patch: Partial<JourneyParty>): void {
    const route = routeFor(id)
    setRoute(id, { ...route, party: { ...route.party, ...patch } })
  }

  function setSeed(id: CampaignId, seed: number): void {
    setRoute(id, { ...routeFor(id), seed: Math.max(0, Math.floor(seed)) })
  }

  function reroll(id: CampaignId): void {
    setSeed(id, Math.floor(Math.random() * 1_000_000))
  }

  function setStart(id: CampaignId, start: CalendarDay): void {
    setRoute(id, { ...routeFor(id), start })
  }

  function walk(id: CampaignId): JourneyReport {
    const route = routeFor(id)
    return planJourney({
      legs: route.legs,
      party: route.party,
      start: route.start,
      calendar: route.calendar,
      rng: buildSeededRng(route.seed),
    })
  }

  function cost(id: CampaignId): number {
    return routeCost(routeFor(id).legs)
  }

  function clear(id: CampaignId): void {
    const next = { byCampaign: { ...state.value.byCampaign } }
    delete next.byCampaign[id]
    state.value = next
    persist(state.value)
  }

  const routedCampaigns = computed(() => Object.keys(state.value.byCampaign))

  function $reset(): void {
    state.value = { byCampaign: {} }
    persist(state.value)
  }

  return {
    routedCampaigns,
    routeFor,
    setRoute,
    addLeg,
    updateLeg,
    removeLeg,
    setParty,
    setSeed,
    setStart,
    reroll,
    walk,
    cost,
    clear,
    $reset,
  }
})

export type { Climate, Season, TravelPace }
