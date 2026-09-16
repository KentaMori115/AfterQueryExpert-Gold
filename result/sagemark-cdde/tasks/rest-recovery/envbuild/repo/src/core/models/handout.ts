import { z } from 'zod'

import type { CampaignId } from '../ids'
import type { ISOTimestamp } from '../time/timestamps'

export type HandoutKind = 'note' | 'letter' | 'map' | 'poster' | 'item-card' | 'rumor'

export const HANDOUT_KINDS: ReadonlyArray<HandoutKind> = [
  'note',
  'letter',
  'map',
  'poster',
  'item-card',
  'rumor',
]

export type HandoutVisibility = 'draft' | 'shared' | 'archived'

export const HANDOUT_VISIBILITIES: ReadonlyArray<HandoutVisibility> = [
  'draft',
  'shared',
  'archived',
]

export interface Handout {
  id: string
  campaignId: CampaignId
  title: string
  body: string
  kind: HandoutKind
  visibility: HandoutVisibility
  signature: string
  recipients: ReadonlyArray<string>
  createdAt: ISOTimestamp
  updatedAt: ISOTimestamp
  sharedAt: ISOTimestamp | null
}

export interface HandoutDraft {
  campaignId: CampaignId
  title: string
  body?: string
  kind?: HandoutKind
  visibility?: HandoutVisibility
  signature?: string
  recipients?: ReadonlyArray<string>
}

export const handoutDraftSchema = z.object({
  campaignId: z.string().min(1),
  title: z.string().trim().min(1, 'title is required').max(160, 'title too long'),
  body: z.string().max(8192, 'body too long').optional(),
  kind: z.enum(['note', 'letter', 'map', 'poster', 'item-card', 'rumor']).optional(),
  visibility: z.enum(['draft', 'shared', 'archived']).optional(),
  signature: z.string().max(120, 'signature too long').optional(),
  recipients: z.array(z.string().trim().min(1).max(80)).max(40, 'too many recipients').optional(),
})

export type HandoutDraftInput = z.input<typeof handoutDraftSchema>

export function kindLabel(k: HandoutKind): string {
  switch (k) {
    case 'note':
      return 'Note'
    case 'letter':
      return 'Letter'
    case 'map':
      return 'Map'
    case 'poster':
      return 'Poster'
    case 'item-card':
      return 'Item card'
    case 'rumor':
      return 'Rumor'
  }
}

export function visibilityLabel(v: HandoutVisibility): string {
  switch (v) {
    case 'draft':
      return 'Draft'
    case 'shared':
      return 'Shared'
    case 'archived':
      return 'Archived'
  }
}

export function visibilityTone(v: HandoutVisibility): 'neutral' | 'success' | 'info' {
  switch (v) {
    case 'draft':
      return 'neutral'
    case 'shared':
      return 'success'
    case 'archived':
      return 'info'
  }
}

export function isShareable(h: Handout): boolean {
  return h.visibility === 'draft' || h.visibility === 'archived'
}

export function isShared(h: Handout): boolean {
  return h.visibility === 'shared'
}

export function recipientLine(h: Handout): string {
  if (h.recipients.length === 0) return 'no recipients yet'
  if (h.recipients.length === 1) return `for ${h.recipients[0]}`
  return `for ${h.recipients.slice(0, -1).join(', ')} and ${h.recipients[h.recipients.length - 1]}`
}
