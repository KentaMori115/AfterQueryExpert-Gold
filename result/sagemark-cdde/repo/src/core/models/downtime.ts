import { z } from 'zod'

import type { CampaignId, CharacterId } from '../ids'
import type { ISOTimestamp } from '../time/timestamps'

export type DowntimeKind =
  | 'crafting'
  | 'research'
  | 'training'
  | 'carousing'
  | 'work'
  | 'recovery'
  | 'travel'
  | 'investigation'

export const DOWNTIME_KINDS: ReadonlyArray<DowntimeKind> = [
  'crafting',
  'research',
  'training',
  'carousing',
  'work',
  'recovery',
  'travel',
  'investigation',
]

const KIND_LABELS: Record<DowntimeKind, string> = {
  crafting: 'Crafting',
  research: 'Research',
  training: 'Training',
  carousing: 'Carousing',
  work: 'Day job',
  recovery: 'Recovery',
  travel: 'Travel',
  investigation: 'Investigation',
}

const KIND_TONES: Record<DowntimeKind, 'info' | 'warning' | 'success' | 'neutral' | 'danger'> = {
  crafting: 'info',
  research: 'info',
  training: 'success',
  carousing: 'warning',
  work: 'neutral',
  recovery: 'success',
  travel: 'neutral',
  investigation: 'warning',
}

export type DowntimeOutcome = 'planned' | 'underway' | 'paid off' | 'failed'

export const DOWNTIME_OUTCOMES: ReadonlyArray<DowntimeOutcome> = [
  'planned',
  'underway',
  'paid off',
  'failed',
]

const OUTCOME_TONES: Record<DowntimeOutcome, 'info' | 'warning' | 'success' | 'danger'> = {
  planned: 'info',
  underway: 'warning',
  'paid off': 'success',
  failed: 'danger',
}

export interface DowntimeActivity {
  id: string
  campaignId: CampaignId
  characterId: CharacterId
  kind: DowntimeKind
  outcome: DowntimeOutcome
  weeks: number
  description: string
  reward: string
  createdAt: ISOTimestamp
  updatedAt: ISOTimestamp
}

export interface DowntimeDraft {
  campaignId: CampaignId
  characterId: CharacterId
  kind: DowntimeKind
  weeks?: number
  description?: string
  reward?: string
}

export function downtimeKindLabel(kind: DowntimeKind): string {
  return KIND_LABELS[kind]
}

export function downtimeKindTone(
  kind: DowntimeKind,
): 'info' | 'warning' | 'success' | 'neutral' | 'danger' {
  return KIND_TONES[kind]
}

export function downtimeOutcomeTone(
  outcome: DowntimeOutcome,
): 'info' | 'warning' | 'success' | 'danger' {
  return OUTCOME_TONES[outcome]
}

export const downtimeDraftSchema = z.object({
  campaignId: z.string().min(1),
  characterId: z.string().min(1),
  kind: z.enum(DOWNTIME_KINDS as unknown as [DowntimeKind, ...DowntimeKind[]]),
  weeks: z.number().int().min(0).max(520).optional(),
  description: z.string().max(280).optional(),
  reward: z.string().max(280).optional(),
})

export function totalWeeksFor(
  activities: ReadonlyArray<DowntimeActivity>,
  characterId: CharacterId,
): number {
  return activities
    .filter((a) => a.characterId === characterId)
    .reduce((acc, a) => acc + Math.max(0, a.weeks), 0)
}

export function compareForListing(a: DowntimeActivity, b: DowntimeActivity): number {
  const aActive = a.outcome === 'underway' ? 0 : a.outcome === 'planned' ? 1 : 2
  const bActive = b.outcome === 'underway' ? 0 : b.outcome === 'planned' ? 1 : 2
  if (aActive !== bActive) return aActive - bActive
  if (b.updatedAt < a.updatedAt) return -1
  if (b.updatedAt > a.updatedAt) return 1
  return 0
}
