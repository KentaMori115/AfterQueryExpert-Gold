import { z } from 'zod'

import type { CampaignId, TagId } from '../ids'
import type { ISOTimestamp } from '../time/timestamps'

export type TagTargetKind =
  | 'character'
  | 'faction'
  | 'location'
  | 'session'
  | 'arc'
  | 'encounter'
  | 'lore'
  | 'item'
  | 'quest'

export const TAG_TARGET_KINDS: ReadonlyArray<TagTargetKind> = [
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

export const TAG_TONES = ['parchment', 'moss', 'ember', 'crimson', 'sky', 'plum'] as const
export type TagTone = (typeof TAG_TONES)[number]

const TONE_LABELS: Record<TagTone, string> = {
  parchment: 'Parchment',
  moss: 'Moss',
  ember: 'Ember',
  crimson: 'Crimson',
  sky: 'Sky',
  plum: 'Plum',
}

const TONE_CLASS: Record<TagTone, string> = {
  parchment: 'bg-parchment-200 text-ink-800',
  moss: 'bg-moss-200 text-moss-900',
  ember: 'bg-ember-200 text-ember-900',
  crimson: 'bg-crimson-100 text-crimson-800',
  sky: 'bg-sky-200 text-sky-900',
  plum: 'bg-purple-200 text-purple-900',
}

export interface Tag {
  id: TagId
  campaignId: CampaignId
  name: string
  slug: string
  tone: TagTone
  description: string
  appliedTo: ReadonlyArray<{ kind: TagTargetKind; id: string }>
  createdAt: ISOTimestamp
  updatedAt: ISOTimestamp
}

export interface TagDraft {
  campaignId: CampaignId
  name: string
  tone?: TagTone
  description?: string
}

export function toneLabel(tone: TagTone): string {
  return TONE_LABELS[tone]
}

export function toneClass(tone: TagTone): string {
  return TONE_CLASS[tone]
}

const slugRe = /[^a-z0-9]+/g

export function slugifyTagName(raw: string): string {
  const trimmed = raw.trim().toLowerCase()
  const sliced = trimmed.replace(slugRe, '-').replace(/^-+|-+$/g, '')
  return sliced.length > 0 ? sliced : 'tag'
}

export function isDuplicateSlug(slug: string, existing: ReadonlyArray<Tag>): boolean {
  return existing.some((t) => t.slug === slug)
}

export function attachedKinds(tag: Tag): ReadonlyArray<TagTargetKind> {
  const set = new Set<TagTargetKind>()
  for (const a of tag.appliedTo) set.add(a.kind)
  return Array.from(set).sort()
}

export function targetCountForKind(tag: Tag, kind: TagTargetKind): number {
  return tag.appliedTo.reduce((acc, a) => acc + (a.kind === kind ? 1 : 0), 0)
}

export function isTargetTagged(tag: Tag, kind: TagTargetKind, id: string): boolean {
  return tag.appliedTo.some((a) => a.kind === kind && a.id === id)
}

export const tagDraftSchema = z.object({
  campaignId: z.string().min(1),
  name: z
    .string()
    .min(1)
    .max(48)
    .refine((n) => n.trim().length > 0, 'name cannot be blank'),
  tone: z.enum(TAG_TONES).optional(),
  description: z.string().max(280).optional(),
})

export function compareTagsForListing(a: Tag, b: Tag): number {
  if (a.appliedTo.length !== b.appliedTo.length) return b.appliedTo.length - a.appliedTo.length
  return a.name.localeCompare(b.name)
}
