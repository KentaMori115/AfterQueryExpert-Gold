import type { RandomSource } from '../dice/roll'

// Classic 2d6 + modifier reaction table. Higher rolls are friendlier.

export type ReactionMood = 'hostile' | 'unfriendly' | 'cautious' | 'neutral' | 'friendly' | 'helpful'

export const REACTION_MOODS: ReadonlyArray<ReactionMood> = [
  'hostile',
  'unfriendly',
  'cautious',
  'neutral',
  'friendly',
  'helpful',
]

const MOOD_LABELS: Record<ReactionMood, string> = {
  hostile: 'Hostile',
  unfriendly: 'Unfriendly',
  cautious: 'Cautious',
  neutral: 'Neutral',
  friendly: 'Friendly',
  helpful: 'Helpful',
}

const MOOD_TONES: Record<ReactionMood, 'danger' | 'warning' | 'info' | 'neutral' | 'success'> = {
  hostile: 'danger',
  unfriendly: 'warning',
  cautious: 'warning',
  neutral: 'info',
  friendly: 'success',
  helpful: 'success',
}

const MOOD_DESCRIPTIONS: Record<ReactionMood, string> = {
  hostile: 'will attack on the next slight',
  unfriendly: 'will not help and may obstruct',
  cautious: 'will deal at arm length, watch hands',
  neutral: 'will do business, no favours',
  friendly: 'helpful with reasonable favours',
  helpful: 'will go out of their way to help',
}

export function moodLabel(mood: ReactionMood): string {
  return MOOD_LABELS[mood]
}

export function moodTone(
  mood: ReactionMood,
): 'danger' | 'warning' | 'info' | 'neutral' | 'success' {
  return MOOD_TONES[mood]
}

export function moodDescription(mood: ReactionMood): string {
  return MOOD_DESCRIPTIONS[mood]
}

export function classifyReaction(total: number): ReactionMood {
  if (total <= 2) return 'hostile'
  if (total <= 5) return 'unfriendly'
  if (total <= 7) return 'cautious'
  if (total <= 9) return 'neutral'
  if (total <= 11) return 'friendly'
  return 'helpful'
}

export interface ReactionRoll {
  d1: number
  d2: number
  modifier: number
  total: number
  mood: ReactionMood
}

export function rollReaction(rng: RandomSource, modifier = 0): ReactionRoll {
  const d1 = 1 + Math.floor(rng() * 6)
  const d2 = 1 + Math.floor(rng() * 6)
  const total = d1 + d2 + modifier
  return {
    d1,
    d2,
    modifier,
    total,
    mood: classifyReaction(total),
  }
}

// Morale uses a 2d6 vs morale rating check. If 2d6 rolls higher than the
// morale rating, the creature breaks. Lower rating means flightier creature.

export type MoraleTier = 'fanatic' | 'steady' | 'wavering' | 'fragile'

const MORALE_RATINGS: Record<MoraleTier, number> = {
  fanatic: 11,
  steady: 9,
  wavering: 7,
  fragile: 5,
}

export const MORALE_TIERS: ReadonlyArray<MoraleTier> = ['fanatic', 'steady', 'wavering', 'fragile']

export function moraleRating(tier: MoraleTier): number {
  return MORALE_RATINGS[tier]
}

export interface MoraleCheck {
  d1: number
  d2: number
  total: number
  rating: number
  passed: boolean
  margin: number
}

export function rollMorale(rng: RandomSource, tier: MoraleTier): MoraleCheck {
  const d1 = 1 + Math.floor(rng() * 6)
  const d2 = 1 + Math.floor(rng() * 6)
  const total = d1 + d2
  const rating = MORALE_RATINGS[tier]
  return {
    d1,
    d2,
    total,
    rating,
    passed: total <= rating,
    margin: rating - total,
  }
}

export function tierLabel(tier: MoraleTier): string {
  return tier.charAt(0).toUpperCase() + tier.slice(1)
}
