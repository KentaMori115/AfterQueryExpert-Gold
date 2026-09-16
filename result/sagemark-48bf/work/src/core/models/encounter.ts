import { z } from 'zod'

import type {
  CampaignId,
  CharacterId,
  EncounterId,
  LocationId,
  SessionId,
} from '../ids'
import type { ISOTimestamp } from '../time/timestamps'

export type EncounterKind = 'combat' | 'social' | 'puzzle' | 'chase' | 'mixed'

export const ENCOUNTER_KINDS: ReadonlyArray<EncounterKind> = [
  'combat',
  'social',
  'puzzle',
  'chase',
  'mixed',
]

export type EncounterDifficulty = 'trivial' | 'easy' | 'medium' | 'hard' | 'deadly'

export const ENCOUNTER_DIFFICULTIES: ReadonlyArray<EncounterDifficulty> = [
  'trivial',
  'easy',
  'medium',
  'hard',
  'deadly',
]

export interface InitiativeEntry {
  characterId: CharacterId | null
  name: string
  initiative: number
  hp: number
  notes: string
}

export interface Encounter {
  id: EncounterId
  campaignId: CampaignId
  sessionId: SessionId | null
  locationId: LocationId | null
  title: string
  kind: EncounterKind
  difficulty: EncounterDifficulty
  summary: string
  initiative: ReadonlyArray<InitiativeEntry>
  resolved: boolean
  createdAt: ISOTimestamp
  updatedAt: ISOTimestamp
}

export interface EncounterDraft {
  campaignId: CampaignId
  sessionId?: SessionId | null
  locationId?: LocationId | null
  title: string
  kind?: EncounterKind
  difficulty?: EncounterDifficulty
  summary?: string
  initiative?: ReadonlyArray<InitiativeEntry>
  resolved?: boolean
}

const initiativeEntrySchema = z.object({
  characterId: z.string().nullable(),
  name: z.string().trim().min(1, 'each entry needs a name').max(80, 'name too long'),
  initiative: z.number().int().min(-50, 'initiative too low').max(50, 'initiative too high'),
  hp: z.number().int().min(-9999, 'hp out of range').max(9999, 'hp out of range'),
  notes: z.string().max(240, 'note too long'),
})

export const encounterDraftSchema = z.object({
  campaignId: z.string().min(1),
  sessionId: z.string().nullable().optional(),
  locationId: z.string().nullable().optional(),
  title: z.string().trim().min(1, 'title is required').max(160, 'title too long'),
  kind: z.enum(['combat', 'social', 'puzzle', 'chase', 'mixed']).optional(),
  difficulty: z.enum(['trivial', 'easy', 'medium', 'hard', 'deadly']).optional(),
  summary: z.string().max(2048, 'summary too long').optional(),
  initiative: z.array(initiativeEntrySchema).max(20, 'too many entries').optional(),
  resolved: z.boolean().optional(),
})

export type EncounterDraftInput = z.input<typeof encounterDraftSchema>

export function kindLabel(k: EncounterKind): string {
  switch (k) {
    case 'combat':
      return 'Combat'
    case 'social':
      return 'Social'
    case 'puzzle':
      return 'Puzzle'
    case 'chase':
      return 'Chase'
    case 'mixed':
      return 'Mixed'
  }
}

export function difficultyLabel(d: EncounterDifficulty): string {
  switch (d) {
    case 'trivial':
      return 'Trivial'
    case 'easy':
      return 'Easy'
    case 'medium':
      return 'Medium'
    case 'hard':
      return 'Hard'
    case 'deadly':
      return 'Deadly'
  }
}

export function difficultyTone(d: EncounterDifficulty): 'success' | 'warning' | 'danger' | 'info' | 'neutral' {
  switch (d) {
    case 'trivial':
    case 'easy':
      return 'success'
    case 'medium':
      return 'info'
    case 'hard':
      return 'warning'
    case 'deadly':
      return 'danger'
  }
}

export function rolledInitiativeOrder(entries: ReadonlyArray<InitiativeEntry>): InitiativeEntry[] {
  return [...entries].sort((a, b) => {
    if (b.initiative !== a.initiative) return b.initiative - a.initiative
    return a.name.localeCompare(b.name)
  })
}

export function downedCount(entries: ReadonlyArray<InitiativeEntry>): number {
  return entries.filter((e) => e.hp <= 0).length
}
