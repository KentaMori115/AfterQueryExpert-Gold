import { z } from 'zod'

import type { CampaignId, CharacterId } from '../ids'
import type { ISOTimestamp } from '../time/timestamps'

export type XpEntryKind = 'award' | 'deduct' | 'milestone'

export const XP_ENTRY_KINDS: ReadonlyArray<XpEntryKind> = ['award', 'deduct', 'milestone']

export interface XpEntry {
  id: string
  campaignId: CampaignId
  characterId: CharacterId
  kind: XpEntryKind
  amount: number
  reason: string
  recordedAt: ISOTimestamp
}

export interface XpEntryDraft {
  campaignId: CampaignId
  characterId: CharacterId
  kind?: XpEntryKind
  amount: number
  reason?: string
}

export const xpEntryDraftSchema = z.object({
  campaignId: z.string().min(1),
  characterId: z.string().min(1),
  kind: z.enum(['award', 'deduct', 'milestone']).optional(),
  amount: z.number().int('xp must be a whole number').min(0, 'xp cannot be negative'),
  reason: z.string().max(200, 'reason too long').optional(),
})

export type XpEntryDraftInput = z.input<typeof xpEntryDraftSchema>

export function kindLabel(kind: XpEntryKind): string {
  switch (kind) {
    case 'award':
      return 'Award'
    case 'deduct':
      return 'Deduct'
    case 'milestone':
      return 'Milestone'
  }
}

export function applySignedAmount(entry: XpEntry): number {
  switch (entry.kind) {
    case 'award':
      return entry.amount
    case 'deduct':
      return -entry.amount
    case 'milestone':
      return entry.amount
  }
}

export function totalXpFromLog(entries: ReadonlyArray<XpEntry>): number {
  let total = 0
  for (const entry of entries) {
    total += applySignedAmount(entry)
  }
  return Math.max(0, total)
}

export function summariseEntry(entry: XpEntry): string {
  const sign = entry.kind === 'deduct' ? '-' : '+'
  const tag = kindLabel(entry.kind)
  const reason = entry.reason ? ` (${entry.reason})` : ''
  return `${tag} ${sign}${entry.amount}${reason}`
}
