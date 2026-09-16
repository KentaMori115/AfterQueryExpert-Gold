// Light source catalog for tabletop dungeons. Tracks burn rate in minutes and
// bright vs dim radius in feet.

export type LightSource =
  | 'torch'
  | 'oil-lantern'
  | 'hooded-lantern'
  | 'bullseye-lantern'
  | 'candle'
  | 'driftglobe'
  | 'continual-flame'

export const LIGHT_SOURCES: ReadonlyArray<LightSource> = [
  'torch',
  'oil-lantern',
  'hooded-lantern',
  'bullseye-lantern',
  'candle',
  'driftglobe',
  'continual-flame',
]

export interface LightProfile {
  label: string
  brightFeet: number
  dimFeet: number
  burnMinutes: number
  flickerNote: string
}

const PROFILES: Record<LightSource, LightProfile> = {
  torch: {
    label: 'Torch',
    brightFeet: 20,
    dimFeet: 20,
    burnMinutes: 60,
    flickerNote: 'Flickers in strong wind, sputters in rain',
  },
  'oil-lantern': {
    label: 'Oil lantern',
    brightFeet: 30,
    dimFeet: 30,
    burnMinutes: 360,
    flickerNote: 'Pints of oil last six hours, smells of fish',
  },
  'hooded-lantern': {
    label: 'Hooded lantern',
    brightFeet: 30,
    dimFeet: 30,
    burnMinutes: 360,
    flickerNote: 'Shutter can squelch the light to a 5 ft dim radius',
  },
  'bullseye-lantern': {
    label: 'Bullseye lantern',
    brightFeet: 60,
    dimFeet: 60,
    burnMinutes: 360,
    flickerNote: 'Cone of light, narrow but reaches far',
  },
  candle: {
    label: 'Candle',
    brightFeet: 5,
    dimFeet: 5,
    burnMinutes: 60,
    flickerNote: 'Personal use only, fragile in a breeze',
  },
  driftglobe: {
    label: 'Driftglobe',
    brightFeet: 30,
    dimFeet: 30,
    burnMinutes: Number.POSITIVE_INFINITY,
    flickerNote: 'Sentient, floats, never burns out',
  },
  'continual-flame': {
    label: 'Continual flame',
    brightFeet: 20,
    dimFeet: 20,
    burnMinutes: Number.POSITIVE_INFINITY,
    flickerNote: 'Magical, indistinguishable from torchlight at a glance',
  },
}

export function lightProfile(source: LightSource): LightProfile {
  return PROFILES[source]
}

export type Vision = 'normal' | 'darkvision-60' | 'darkvision-120' | 'blindsight' | 'truesight'

export const VISIONS: ReadonlyArray<Vision> = [
  'normal',
  'darkvision-60',
  'darkvision-120',
  'blindsight',
  'truesight',
]

const VISION_LABELS: Record<Vision, string> = {
  normal: 'Normal',
  'darkvision-60': 'Darkvision 60 ft',
  'darkvision-120': 'Darkvision 120 ft',
  blindsight: 'Blindsight',
  truesight: 'Truesight',
}

export function visionLabel(v: Vision): string {
  return VISION_LABELS[v]
}

export type Visibility = 'bright' | 'dim' | 'darkness'

export function visibilityAt(
  distance: number,
  source: LightSource | null,
  ambient: Visibility = 'darkness',
): Visibility {
  if (distance < 0) distance = 0
  if (source) {
    const profile = PROFILES[source]
    if (distance <= profile.brightFeet) return 'bright'
    if (distance <= profile.brightFeet + profile.dimFeet) return 'dim'
  }
  return ambient
}

export function effectivelySeesAt(
  distance: number,
  vision: Vision,
  source: LightSource | null,
  ambient: Visibility = 'darkness',
): boolean {
  const v = visibilityAt(distance, source, ambient)
  if (v === 'bright') return true
  if (v === 'dim') return vision !== 'normal'
  // darkness
  if (vision === 'normal') return false
  if (vision === 'darkvision-60') return distance <= 60
  if (vision === 'darkvision-120') return distance <= 120
  return true
}

export function burnDownMinutes(remaining: number, elapsed: number): number {
  if (!Number.isFinite(remaining)) return Number.POSITIVE_INFINITY
  if (elapsed <= 0) return remaining
  return Math.max(0, Math.floor(remaining - elapsed))
}
