// Overland travel resolved one day at a time.
//
// estimateTravel next door answers "roughly how long is this trip", which is
// the right question at the table right up until the party is four days into a
// swamp on half rations. This module walks the road instead: a route made of
// legs, one weather roll a day, food out of the packs every evening, and the
// exhaustion that a forced march and an empty stomach leave behind.
//
// Nothing here puts exhaustion back. Sleeping it off belongs to rest, not to
// the road.

import type { RandomSource } from '../dice/roll'
import { type CalendarDay, type CalendarShape, advanceDays } from '../lib/inworld-calendar'

import { type ExhaustionLevel, clampExhaustion } from './conditions'
import { type SupplyState, drawRations, loseRations, startingSupply } from './supply'
import {
  type Climate,
  type Season,
  type TravelPace,
  type WeatherSeverity,
  paceMultiplier,
  rollWeather,
} from './weather'

/** One stretch of road walked at one pace, under one sky. */
export interface JourneyLeg {
  name: string
  /** How long the stretch is, in miles. */
  miles: number
  /** What a mile of it costs against the day's march. Open road is 1. */
  costPerMile: number
  climate: Climate
  season: Season
  pace: TravelPace
}

/** Who is walking, how fast, and what they carry. */
export interface JourneyParty {
  /** Mouths at the fire. Each eats one ration a day. */
  size: number
  /** Miles of open road the party covers on a clear day at normal pace. */
  milesPerDay: number
  /** Whole rations in the packs at the trailhead. */
  rations: number
  /** Exhaustion the party sets out carrying. */
  exhaustion: ExhaustionLevel
}

export interface JourneyPlan {
  legs: ReadonlyArray<JourneyLeg>
  party: JourneyParty
  /** In world date of the first day on the road. */
  start: CalendarDay
  calendar: CalendarShape
  /**
   * Where the weather comes from. One source for the whole walk, drawn once a
   * day, so a seeded one replays the same journey every time.
   */
  rng?: RandomSource
}

/** One day on the road, as it happened. */
export interface JourneyDay {
  date: CalendarDay
  /** The leg the party woke up on. */
  legName: string
  /** Label of the weather that day, straight off the climate table. */
  weather: string
  severity: WeatherSeverity
  /** Miles of open road the day was worth once weather and exhaustion bit. */
  allowance: number
  /** Miles actually walked, which the rough ground can make far fewer. */
  covered: number
  rationsLeft: number
  /** True when the packs could not feed everyone. */
  hungry: boolean
  /** Exhaustion the party goes to sleep on. */
  exhaustion: ExhaustionLevel
}

export interface JourneyReport {
  days: ReadonlyArray<JourneyDay>
  /** True when every leg is behind the party. */
  arrived: boolean
  /** True when a day covered no ground at all, which ends the walk. */
  stalled: boolean
  /** The day the last leg ran out, or null for a walk that never finished. */
  arrivalDate: CalendarDay | null
  /** Miles of road still ahead. */
  milesLeft: number
  rationsLeft: number
  hungryDays: number
  exhaustion: ExhaustionLevel
}

// A walk that neither arrives nor stalls cannot happen: an unfed party runs
// itself to a standstill, and a fed one keeps a constant pace. The cap is here
// so a nonsense plan cannot hang a browser tab.
const MAX_DAYS = 3650

/**
 * Walk a route and report every day of it.
 *
 * The day is always the same shape. Roll the weather for the leg the party
 * wakes up on. Work out what the day is worth: the party's open road pace,
 * times the pace of that leg, times what the weather leaves, times what
 * exhaustion leaves. Spend it along the route, rough ground eating it faster
 * than open road, and let it run on into the next leg if the leg ends before
 * the day does. Then eat, count what the weather spoiled, and add up what the
 * march cost.
 */
export function planJourney(plan: JourneyPlan): JourneyReport {
  const rng = plan.rng ?? Math.random
  const legs = plan.legs ?? []
  const remaining = legs.map((leg) => positiveMiles(leg.miles))
  const mouths = Math.max(0, Math.floor(plan.party.size))
  const openRoad = Math.max(0, plan.party.milesPerDay)

  let supply: SupplyState = startingSupply(plan.party.rations)
  let exhaustion = clampExhaustion(plan.party.exhaustion)
  let index = firstUnwalked(remaining, 0)
  let stalled = false
  const days: JourneyDay[] = []

  while (index < legs.length && days.length < MAX_DAYS) {
    const leg = legs[index]!
    const date = advanceDays(plan.start, days.length, plan.calendar)
    const weather = rollWeather(leg.climate, leg.season, rng)

    const allowance = round1(
      openRoad *
        paceMultiplier(leg.pace) *
        (1 - Math.min(0.9, weather.travelPenalty)) *
        marchFactor(exhaustion),
    )

    let left = allowance
    let covered = 0
    while (left > 0 && index < legs.length) {
      const ahead = remaining[index]!
      const cost = ahead * positiveCost(legs[index]!.costPerMile)
      if (cost <= left + 1e-9) {
        covered += ahead
        left -= cost
        remaining[index] = 0
        index = firstUnwalked(remaining, index + 1)
        continue
      }
      const walked = left / positiveCost(legs[index]!.costPerMile)
      remaining[index] = ahead - walked
      covered += walked
      left = 0
    }

    const fed = drawRations(supply, mouths)
    supply = weather.severity === 'severe' ? loseRations(fed.state, 1) : fed.state
    const hungry = fed.short > 0
    exhaustion = clampExhaustion(
      exhaustion + (leg.pace === 'forced' ? 1 : 0) + (hungry ? 1 : 0),
    )

    days.push({
      date,
      legName: leg.name,
      weather: weather.label,
      severity: weather.severity,
      allowance,
      covered: round1(covered),
      rationsLeft: supply.rations,
      hungry,
      exhaustion,
    })

    if (round1(covered) <= 0) {
      stalled = true
      break
    }
  }

  const arrived = !stalled && index >= legs.length
  return {
    days,
    arrived,
    stalled,
    arrivalDate: arrivalDate(arrived, days, plan.start),
    milesLeft: round1(remaining.reduce((sum, miles) => sum + Math.max(0, miles), 0)),
    rationsLeft: supply.rations,
    hungryDays: supply.hungryDays,
    exhaustion,
  }
}

/** What exhaustion leaves of a day's march: half at 2, nothing at 5. */
export function marchFactor(level: ExhaustionLevel): number {
  if (level >= 5) return 0
  if (level >= 2) return 0.5
  return 1
}

/** Total cost of a route, in miles of open road. */
export function routeCost(legs: ReadonlyArray<JourneyLeg>): number {
  return round1(
    legs.reduce((sum, leg) => sum + positiveMiles(leg.miles) * positiveCost(leg.costPerMile), 0),
  )
}

function arrivalDate(
  arrived: boolean,
  days: ReadonlyArray<JourneyDay>,
  start: CalendarDay,
): CalendarDay | null {
  if (!arrived) return null
  if (days.length === 0) return start
  return days[days.length - 1]!.date
}

function firstUnwalked(remaining: ReadonlyArray<number>, from: number): number {
  let i = Math.max(0, from)
  while (i < remaining.length && remaining[i]! <= 0) i++
  return i
}

function positiveMiles(miles: number): number {
  if (!Number.isFinite(miles) || miles <= 0) return 0
  return miles
}

function positiveCost(cost: number): number {
  if (!Number.isFinite(cost) || cost <= 0) return 0
  return cost
}

function round1(value: number): number {
  return Math.round((value + Number.EPSILON) * 10) / 10
}
