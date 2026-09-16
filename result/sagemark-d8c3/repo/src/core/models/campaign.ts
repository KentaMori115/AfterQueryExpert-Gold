import { z } from 'zod'

import type { CampaignId } from '../ids'
import type { ISOTimestamp } from '../time/timestamps'

export type CampaignSystem = 'dnd5e' | 'pf2e' | 'savage-worlds' | 'cypher' | 'custom' | 'other'

export const CAMPAIGN_SYSTEMS: ReadonlyArray<CampaignSystem> = [
  'dnd5e',
  'pf2e',
  'savage-worlds',
  'cypher',
  'custom',
  'other',
]

export type CampaignStatus = 'planning' | 'active' | 'paused' | 'finished' | 'archived'

export const CAMPAIGN_STATUSES: ReadonlyArray<CampaignStatus> = [
  'planning',
  'active',
  'paused',
  'finished',
  'archived',
]

export interface Campaign {
  id: CampaignId
  name: string
  tagline: string
  system: CampaignSystem
  status: CampaignStatus
  startedAt: ISOTimestamp | null
  lastPlayedAt: ISOTimestamp | null
  sessionCount: number
  createdAt: ISOTimestamp
  updatedAt: ISOTimestamp
}

export interface CampaignDraft {
  name: string
  tagline?: string
  system?: CampaignSystem
  status?: CampaignStatus
}

export const campaignDraftSchema = z.object({
  name: z.string().trim().min(1, 'name is required').max(120, 'name is too long'),
  tagline: z.string().trim().max(240, 'tagline is too long').optional(),
  system: z
    .enum(['dnd5e', 'pf2e', 'savage-worlds', 'cypher', 'custom', 'other'])
    .optional(),
  status: z
    .enum(['planning', 'active', 'paused', 'finished', 'archived'])
    .optional(),
})

export type CampaignDraftInput = z.input<typeof campaignDraftSchema>

export function systemLabel(system: CampaignSystem): string {
  switch (system) {
    case 'dnd5e':
      return 'D&D 5e'
    case 'pf2e':
      return 'Pathfinder 2e'
    case 'savage-worlds':
      return 'Savage Worlds'
    case 'cypher':
      return 'Cypher System'
    case 'custom':
      return 'Custom'
    case 'other':
      return 'Other'
  }
}

export function statusLabel(status: CampaignStatus): string {
  switch (status) {
    case 'planning':
      return 'Planning'
    case 'active':
      return 'Active'
    case 'paused':
      return 'Paused'
    case 'finished':
      return 'Finished'
    case 'archived':
      return 'Archived'
  }
}

export function isOpen(campaign: Campaign): boolean {
  return campaign.status === 'planning' || campaign.status === 'active' || campaign.status === 'paused'
}

export function isClosed(campaign: Campaign): boolean {
  return !isOpen(campaign)
}

export function comparableSortKey(c: Campaign): string {
  // Active campaigns sort earlier than archived; otherwise newest first
  const bucket = isOpen(c) ? '0' : '1'
  const ts = c.lastPlayedAt ?? c.updatedAt
  // Invert so newer ts sorts earlier
  const inv = String(9_999_999_999_999 - Date.parse(ts)).padStart(13, '0')
  return `${bucket}-${inv}`
}
