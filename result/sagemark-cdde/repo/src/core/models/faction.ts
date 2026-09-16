import { z } from 'zod'

import type { CampaignId, CharacterId, FactionId, LocationId } from '../ids'
import type { ISOTimestamp } from '../time/timestamps'

export type FactionAlignment = 'good' | 'neutral' | 'evil' | 'mixed' | 'unknown'

export const FACTION_ALIGNMENTS: ReadonlyArray<FactionAlignment> = [
  'good',
  'neutral',
  'evil',
  'mixed',
  'unknown',
]

export type FactionScope = 'town' | 'regional' | 'national' | 'global' | 'hidden'

export const FACTION_SCOPES: ReadonlyArray<FactionScope> = [
  'town',
  'regional',
  'national',
  'global',
  'hidden',
]

export interface Faction {
  id: FactionId
  campaignId: CampaignId
  name: string
  motto: string
  description: string
  alignment: FactionAlignment
  scope: FactionScope
  influence: number // 0-100
  leaderId: CharacterId | null
  seatId: LocationId | null
  active: boolean
  createdAt: ISOTimestamp
  updatedAt: ISOTimestamp
}

export interface FactionDraft {
  campaignId: CampaignId
  name: string
  motto?: string
  description?: string
  alignment?: FactionAlignment
  scope?: FactionScope
  influence?: number
  leaderId?: CharacterId | null
  seatId?: LocationId | null
  active?: boolean
}

export const factionDraftSchema = z.object({
  campaignId: z.string().min(1),
  name: z.string().trim().min(1, 'name is required').max(120, 'name is too long'),
  motto: z.string().trim().max(160, 'motto too long').optional(),
  description: z.string().max(2048, 'description too long').optional(),
  alignment: z.enum(['good', 'neutral', 'evil', 'mixed', 'unknown']).optional(),
  scope: z.enum(['town', 'regional', 'national', 'global', 'hidden']).optional(),
  influence: z.number().int().min(0, 'influence must be at least 0').max(100, 'influence is 0-100').optional(),
  leaderId: z.string().nullable().optional(),
  seatId: z.string().nullable().optional(),
  active: z.boolean().optional(),
})

export type FactionDraftInput = z.input<typeof factionDraftSchema>

export function alignmentLabel(a: FactionAlignment): string {
  switch (a) {
    case 'good':
      return 'Good'
    case 'neutral':
      return 'Neutral'
    case 'evil':
      return 'Evil'
    case 'mixed':
      return 'Mixed'
    case 'unknown':
      return 'Unknown'
  }
}

export function alignmentTone(a: FactionAlignment): 'success' | 'warning' | 'danger' | 'info' | 'neutral' {
  switch (a) {
    case 'good':
      return 'success'
    case 'mixed':
      return 'warning'
    case 'evil':
      return 'danger'
    case 'neutral':
      return 'info'
    default:
      return 'neutral'
  }
}

export function scopeLabel(s: FactionScope): string {
  switch (s) {
    case 'town':
      return 'Town'
    case 'regional':
      return 'Regional'
    case 'national':
      return 'National'
    case 'global':
      return 'Global'
    case 'hidden':
      return 'Hidden'
  }
}

export function influenceTier(influence: number): 'fringe' | 'rising' | 'major' | 'dominant' {
  if (influence < 20) return 'fringe'
  if (influence < 50) return 'rising'
  if (influence < 80) return 'major'
  return 'dominant'
}

export function influenceTierLabel(influence: number): string {
  switch (influenceTier(influence)) {
    case 'fringe':
      return 'On the fringes'
    case 'rising':
      return 'On the rise'
    case 'major':
      return 'A major power'
    case 'dominant':
      return 'Dominant'
  }
}
