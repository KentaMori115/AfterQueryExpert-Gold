import { z } from 'zod'

import type { CampaignId, NoteId } from '../ids'
import type { ISOTimestamp } from '../time/timestamps'

export type NoteTargetKind =
  | 'campaign'
  | 'character'
  | 'faction'
  | 'location'
  | 'session'
  | 'arc'
  | 'encounter'
  | 'lore'
  | 'item'
  | 'quest'

export const NOTE_TARGET_KINDS: ReadonlyArray<NoteTargetKind> = [
  'campaign',
  'character',
  'faction',
  'location',
  'session',
  'arc',
  'encounter',
  'lore',
  'item',
  'quest',
]

export type NotePriority = 'low' | 'normal' | 'high' | 'critical'

export const NOTE_PRIORITIES: ReadonlyArray<NotePriority> = ['low', 'normal', 'high', 'critical']

export interface NoteTarget {
  kind: NoteTargetKind
  id: string
}

export interface Note {
  id: NoteId
  campaignId: CampaignId
  target: NoteTarget
  title: string
  body: string
  priority: NotePriority
  pinned: boolean
  remindAt: ISOTimestamp | null
  resolvedAt: ISOTimestamp | null
  createdAt: ISOTimestamp
  updatedAt: ISOTimestamp
}

export interface NoteDraft {
  campaignId: CampaignId
  target: NoteTarget
  title?: string
  body: string
  priority?: NotePriority
  pinned?: boolean
  remindAt?: ISOTimestamp | string | null
}

const targetSchema = z.object({
  kind: z.enum([
    'campaign',
    'character',
    'faction',
    'location',
    'session',
    'arc',
    'encounter',
    'lore',
    'item',
    'quest',
  ]),
  id: z.string().min(1),
})

export const noteDraftSchema = z.object({
  campaignId: z.string().min(1),
  target: targetSchema,
  title: z.string().trim().max(160, 'title too long').optional(),
  body: z.string().trim().min(1, 'body is required').max(4096, 'body too long'),
  priority: z.enum(['low', 'normal', 'high', 'critical']).optional(),
  pinned: z.boolean().optional(),
  remindAt: z
    .string()
    .nullable()
    .optional()
    .refine((v) => v == null || v === '' || !Number.isNaN(Date.parse(v)), {
      message: 'remindAt must be a parseable date',
    }),
})

export type NoteDraftInput = z.input<typeof noteDraftSchema>

export function priorityLabel(p: NotePriority): string {
  switch (p) {
    case 'low':
      return 'Low'
    case 'normal':
      return 'Normal'
    case 'high':
      return 'High'
    case 'critical':
      return 'Critical'
  }
}

export function priorityTone(p: NotePriority): 'neutral' | 'info' | 'warning' | 'danger' {
  switch (p) {
    case 'low':
      return 'neutral'
    case 'normal':
      return 'info'
    case 'high':
      return 'warning'
    case 'critical':
      return 'danger'
  }
}

export function priorityWeight(p: NotePriority): number {
  switch (p) {
    case 'low':
      return 1
    case 'normal':
      return 2
    case 'high':
      return 3
    case 'critical':
      return 4
  }
}

export function targetLabel(kind: NoteTargetKind): string {
  switch (kind) {
    case 'campaign':
      return 'Campaign'
    case 'character':
      return 'Character'
    case 'faction':
      return 'Faction'
    case 'location':
      return 'Place'
    case 'session':
      return 'Session'
    case 'arc':
      return 'Arc'
    case 'encounter':
      return 'Encounter'
    case 'lore':
      return 'Lore'
    case 'item':
      return 'Item'
    case 'quest':
      return 'Quest'
  }
}

export function isResolved(note: Note): boolean {
  return note.resolvedAt !== null
}

export function isOverdue(note: Note, now: Date = new Date()): boolean {
  if (!note.remindAt || note.resolvedAt) return false
  return Date.parse(note.remindAt) < now.getTime()
}

export function compareNotesForListing(a: Note, b: Note): number {
  if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
  if (a.resolvedAt && !b.resolvedAt) return 1
  if (!a.resolvedAt && b.resolvedAt) return -1
  const pw = priorityWeight(b.priority) - priorityWeight(a.priority)
  if (pw !== 0) return pw
  return b.createdAt.localeCompare(a.createdAt)
}
