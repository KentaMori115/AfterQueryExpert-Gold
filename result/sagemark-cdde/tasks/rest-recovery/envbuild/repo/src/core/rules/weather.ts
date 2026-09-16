import type { RandomSource } from '../dice/roll'

export type WeatherSeverity = 'clear' | 'mild' | 'rough' | 'severe'

export interface WeatherOption {
  label: string
  severity: WeatherSeverity
  weight: number
  travelPenalty: number
  note: string
}

export type Climate = 'temperate' | 'arid' | 'frozen' | 'coastal'
export type Season = 'spring' | 'summer' | 'autumn' | 'winter'

export const CLIMATES: ReadonlyArray<Climate> = ['temperate', 'arid', 'frozen', 'coastal']
export const SEASONS: ReadonlyArray<Season> = ['spring', 'summer', 'autumn', 'winter']

const WEATHER_TABLE: Record<Climate, Record<Season, ReadonlyArray<WeatherOption>>> = {
  temperate: {
    spring: [
      { label: 'Clear, low pollen', severity: 'clear', weight: 4, travelPenalty: 0, note: 'A fine day for the road' },
      { label: 'Light rain', severity: 'mild', weight: 4, travelPenalty: 0.1, note: 'Hoods up, but no real delay' },
      { label: 'Sudden hail', severity: 'rough', weight: 1, travelPenalty: 0.25, note: 'Stoneshower lasts an hour' },
      { label: 'Spring storm', severity: 'severe', weight: 1, travelPenalty: 0.5, note: 'Hide if you can' },
    ],
    summer: [
      { label: 'Clear and warm', severity: 'clear', weight: 5, travelPenalty: 0, note: 'Bring water' },
      { label: 'Muggy afternoon', severity: 'mild', weight: 3, travelPenalty: 0.1, note: 'Sweat through every cloak' },
      { label: 'Thunderhead by dusk', severity: 'rough', weight: 1, travelPenalty: 0.3, note: 'Trees groan, lightning close' },
      { label: 'Heatwave', severity: 'severe', weight: 1, travelPenalty: 0.4, note: 'Travel only at dawn and dusk' },
    ],
    autumn: [
      { label: 'Cool and overcast', severity: 'clear', weight: 4, travelPenalty: 0, note: 'Perfect marching weather' },
      { label: 'Drizzle that wont quit', severity: 'mild', weight: 4, travelPenalty: 0.15, note: 'Everyone is damp' },
      { label: 'Cold front', severity: 'rough', weight: 1, travelPenalty: 0.25, note: 'Wind drops the temp ten degrees' },
      { label: 'Early gale', severity: 'severe', weight: 1, travelPenalty: 0.5, note: 'Trees down across the road' },
    ],
    winter: [
      { label: 'Crisp and clear', severity: 'clear', weight: 3, travelPenalty: 0.1, note: 'Sharp shadows, ice underfoot' },
      { label: 'Light snow', severity: 'mild', weight: 4, travelPenalty: 0.2, note: 'Tracks fill quickly' },
      { label: 'Sleet', severity: 'rough', weight: 2, travelPenalty: 0.35, note: 'Visibility drops, ice everywhere' },
      { label: 'Blizzard', severity: 'severe', weight: 1, travelPenalty: 0.75, note: 'You really should shelter' },
    ],
  },
  arid: {
    spring: [
      { label: 'Cool morning, hot noon', severity: 'mild', weight: 5, travelPenalty: 0.1, note: 'Layer up at dawn' },
      { label: 'Dust haze', severity: 'rough', weight: 3, travelPenalty: 0.2, note: 'Wrap your eyes' },
      { label: 'Sudden flash flood', severity: 'severe', weight: 1, travelPenalty: 0.6, note: 'Wadis become rivers' },
    ],
    summer: [
      { label: 'Blazing sun', severity: 'mild', weight: 3, travelPenalty: 0.2, note: 'Find shade by noon' },
      { label: 'Khamsin wind', severity: 'rough', weight: 3, travelPenalty: 0.35, note: 'Sand on every lip' },
      { label: 'Sandstorm', severity: 'severe', weight: 2, travelPenalty: 0.7, note: 'Lash everything to camels' },
    ],
    autumn: [
      { label: 'Pleasant breeze', severity: 'clear', weight: 5, travelPenalty: 0, note: 'A welcome reprieve' },
      { label: 'Cold dusty wind', severity: 'mild', weight: 3, travelPenalty: 0.15, note: 'Cloaks doubled up' },
      { label: 'Lightning storm at dusk', severity: 'rough', weight: 1, travelPenalty: 0.3, note: 'Stay off ridges' },
    ],
    winter: [
      { label: 'Cold but clear', severity: 'mild', weight: 4, travelPenalty: 0.1, note: 'Frost on the water skins' },
      { label: 'Freezing rain', severity: 'rough', weight: 2, travelPenalty: 0.3, note: 'Ice on the rocks' },
      { label: 'Mountain snowstorm', severity: 'severe', weight: 1, travelPenalty: 0.6, note: 'Passes close' },
    ],
  },
  frozen: {
    spring: [
      { label: 'Thawing, slushy', severity: 'mild', weight: 3, travelPenalty: 0.2, note: 'Streams ride high' },
      { label: 'Late blizzard', severity: 'severe', weight: 1, travelPenalty: 0.7, note: 'Winter is not done with you' },
      { label: 'Calm and bright', severity: 'clear', weight: 2, travelPenalty: 0.1, note: 'Snowblind by noon' },
    ],
    summer: [
      { label: 'Cool and clear', severity: 'clear', weight: 5, travelPenalty: 0, note: 'Make miles while you can' },
      { label: 'Light snow', severity: 'mild', weight: 2, travelPenalty: 0.15, note: 'Yes, even in summer' },
      { label: 'Fog that hides the path', severity: 'rough', weight: 1, travelPenalty: 0.3, note: 'Rope up' },
    ],
    autumn: [
      { label: 'Cold and clear', severity: 'mild', weight: 4, travelPenalty: 0.1, note: 'Early frost' },
      { label: 'First storm of the cold', severity: 'severe', weight: 1, travelPenalty: 0.7, note: 'Winter announces itself' },
    ],
    winter: [
      { label: 'Hard freeze', severity: 'mild', weight: 3, travelPenalty: 0.2, note: 'Frostbite watch' },
      { label: 'Whiteout', severity: 'severe', weight: 3, travelPenalty: 0.85, note: 'Stop, build a snow wall' },
    ],
  },
  coastal: {
    spring: [
      { label: 'Salt breeze', severity: 'clear', weight: 4, travelPenalty: 0, note: 'A gull or two for company' },
      { label: 'Sea fog', severity: 'mild', weight: 4, travelPenalty: 0.2, note: 'Sound carries strangely' },
      { label: 'Squall', severity: 'rough', weight: 2, travelPenalty: 0.3, note: 'Roads slick within minutes' },
    ],
    summer: [
      { label: 'Bright and humid', severity: 'mild', weight: 4, travelPenalty: 0.1, note: 'Hat on, water close' },
      { label: 'Afternoon thunder', severity: 'rough', weight: 2, travelPenalty: 0.3, note: 'Get off the dunes' },
    ],
    autumn: [
      { label: 'Gale warning', severity: 'severe', weight: 2, travelPenalty: 0.5, note: 'Ships in harbour, scribes at home' },
      { label: 'Steady drizzle', severity: 'mild', weight: 4, travelPenalty: 0.15, note: 'Lichen everything' },
    ],
    winter: [
      { label: 'Bitter wind off the water', severity: 'rough', weight: 3, travelPenalty: 0.3, note: 'Wind cuts to bone' },
      { label: 'Hail and sleet', severity: 'rough', weight: 2, travelPenalty: 0.4, note: 'Snow then rain then ice' },
      { label: 'Calm winter day', severity: 'clear', weight: 1, travelPenalty: 0.05, note: 'Sun on the sea' },
    ],
  },
}

export function weatherOptions(climate: Climate, season: Season): ReadonlyArray<WeatherOption> {
  return WEATHER_TABLE[climate][season]
}

export function rollWeather(climate: Climate, season: Season, rng: RandomSource): WeatherOption {
  const opts = weatherOptions(climate, season)
  const totalWeight = opts.reduce((acc, o) => acc + o.weight, 0)
  let pick = rng() * totalWeight
  for (const o of opts) {
    pick -= o.weight
    if (pick <= 0) return o
  }
  return opts[opts.length - 1]!
}

export type TravelPace = 'slow' | 'normal' | 'fast' | 'forced'

export const TRAVEL_PACES: ReadonlyArray<TravelPace> = ['slow', 'normal', 'fast', 'forced']

const PACE_MULTIPLIER: Record<TravelPace, number> = {
  slow: 0.75,
  normal: 1,
  fast: 1.25,
  forced: 1.5,
}

const PACE_DESCRIPTION: Record<TravelPace, string> = {
  slow: 'Cautious - watching the trail and listening',
  normal: 'Steady - a real day on the road',
  fast: 'Pressing - no time for niceties',
  forced: 'Forced march - exhaustion risk after',
}

export interface TravelPlan {
  miles: number
  baseMilesPerDay: number
  pace: TravelPace
  weather: WeatherOption
}

export interface TravelEstimate {
  days: number
  effectiveMilesPerDay: number
  totalPenalty: number
}

export function estimateTravel(plan: TravelPlan): TravelEstimate {
  const base = Math.max(0, plan.baseMilesPerDay)
  const effective = base * PACE_MULTIPLIER[plan.pace] * (1 - Math.min(0.9, plan.weather.travelPenalty))
  const milesPerDay = effective > 0 ? effective : 0.01
  const days = Math.ceil(plan.miles / milesPerDay)
  return {
    days,
    effectiveMilesPerDay: Math.round(milesPerDay * 10) / 10,
    totalPenalty: Math.round(plan.weather.travelPenalty * 100),
  }
}

export function paceDescription(p: TravelPace): string {
  return PACE_DESCRIPTION[p]
}

export function severityTone(s: WeatherSeverity): 'success' | 'info' | 'warning' | 'danger' {
  switch (s) {
    case 'clear':
      return 'success'
    case 'mild':
      return 'info'
    case 'rough':
      return 'warning'
    case 'severe':
      return 'danger'
  }
}
