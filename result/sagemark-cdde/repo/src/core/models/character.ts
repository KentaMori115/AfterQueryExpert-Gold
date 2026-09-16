import { z } from 'zod'

import type { CampaignId, CharacterId, FactionId, LocationId } from '../ids'
import type { ISOTimestamp } from '../time/timestamps'

export type CharacterKind = 'pc' | 'npc'

export const CHARACTER_KINDS: ReadonlyArray<CharacterKind> = ['pc', 'npc']

export type CharacterDisposition =
  | 'friendly'
  | 'allied'
  | 'neutral'
  | 'suspicious'
  | 'hostile'
  | 'unknown'

export const CHARACTER_DISPOSITIONS: ReadonlyArray<CharacterDisposition> = [
  'friendly',
  'allied',
  'neutral',
  'suspicious',
  'hostile',
  'unknown',
]

export interface Character {
  id: CharacterId
  campaignId: CampaignId
  kind: CharacterKind
  name: string
  pronouns: string
  ancestry: string
  vocation: string
  level: number
  disposition: CharacterDisposition
  factionId: FactionId | null
  homeId: LocationId | null
  blurb: string
  alive: boolean
  createdAt: ISOTimestamp
  updatedAt: ISOTimestamp
}

export interface CharacterDraft {
  campaignId: CampaignId
  kind?: CharacterKind
  name: string
  pronouns?: string
  ancestry?: string
  vocation?: string
  level?: number
  disposition?: CharacterDisposition
  factionId?: FactionId | null
  homeId?: LocationId | null
  blurb?: string
  alive?: boolean
}

const idString = z.string().min(1)

export const characterDraftSchema = z.object({
  campaignId: idString,
  kind: z.enum(['pc', 'npc']).optional(),
  name: z.string().trim().min(1, 'name is required').max(120, 'name is too long'),
  pronouns: z.string().trim().max(40, 'pronouns too long').optional(),
  ancestry: z.string().trim().max(60, 'ancestry too long').optional(),
  vocation: z.string().trim().max(80, 'vocation too long').optional(),
  level: z.number().int().min(0, 'level must be 0 or more').max(40, 'level is unreasonably high').optional(),
  disposition: z
    .enum(['friendly', 'allied', 'neutral', 'suspicious', 'hostile', 'unknown'])
    .optional(),
  factionId: idString.nullable().optional(),
  homeId: idString.nullable().optional(),
  blurb: z.string().max(1024, 'blurb too long').optional(),
  alive: z.boolean().optional(),
})

export type CharacterDraftInput = z.input<typeof characterDraftSchema>

export function kindLabel(kind: CharacterKind): string {
  return kind === 'pc' ? 'PC' : 'NPC'
}

export function dispositionLabel(d: CharacterDisposition): string {
  switch (d) {
    case 'friendly':
      return 'Friendly'
    case 'allied':
      return 'Allied'
    case 'neutral':
      return 'Neutral'
    case 'suspicious':
      return 'Suspicious'
    case 'hostile':
      return 'Hostile'
    case 'unknown':
      return 'Unknown'
  }
}

export function dispositionTone(d: CharacterDisposition): 'success' | 'warning' | 'danger' | 'info' | 'neutral' {
  switch (d) {
    case 'allied':
    case 'friendly':
      return 'success'
    case 'suspicious':
      return 'warning'
    case 'hostile':
      return 'danger'
    case 'neutral':
      return 'info'
    default:
      return 'neutral'
  }
}

export function characterFullName(c: Character): string {
  const parts = [c.name]
  if (c.vocation) parts.push(`the ${c.vocation}`)
  return parts.join(' ')
}

export function isPlayerCharacter(c: Character): boolean {
  return c.kind === 'pc'
}

export function isAliveAndRelevant(c: Character): boolean {
  return c.alive && c.disposition !== 'unknown'
}
