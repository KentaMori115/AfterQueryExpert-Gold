import { z } from 'zod'

import type { CampaignId, LoreId } from '../ids'
import type { ISOTimestamp } from '../time/timestamps'

export type LoreCategory =
  | 'history'
  | 'myth'
  | 'culture'
  | 'religion'
  | 'magic'
  | 'rumor'
  | 'organization'
  | 'misc'

export const LORE_CATEGORIES: ReadonlyArray<LoreCategory> = [
  'history',
  'myth',
  'culture',
  'religion',
  'magic',
  'rumor',
  'organization',
  'misc',
]

export interface LoreEntry {
  id: LoreId
  campaignId: CampaignId
  title: string
  body: string
  category: LoreCategory
  tags: ReadonlyArray<string>
  revealed: boolean
  pinned: boolean
  createdAt: ISOTimestamp
  updatedAt: ISOTimestamp
}

export interface LoreDraft {
  campaignId: CampaignId
  title: string
  body?: string
  category?: LoreCategory
  tags?: ReadonlyArray<string>
  revealed?: boolean
  pinned?: boolean
}

export const loreDraftSchema = z.object({
  campaignId: z.string().min(1),
  title: z.string().trim().min(1, 'title is required').max(160, 'title too long'),
  body: z.string().max(8192, 'body too long').optional(),
  category: z.enum([
    'history',
    'myth',
    'culture',
    'religion',
    'magic',
    'rumor',
    'organization',
    'misc',
  ]).optional(),
  tags: z.array(z.string().trim().min(1).max(32)).max(16, 'too many tags').optional(),
  revealed: z.boolean().optional(),
  pinned: z.boolean().optional(),
})

export type LoreDraftInput = z.input<typeof loreDraftSchema>

export function categoryLabel(c: LoreCategory): string {
  switch (c) {
    case 'history':
      return 'History'
    case 'myth':
      return 'Myth'
    case 'culture':
      return 'Culture'
    case 'religion':
      return 'Religion'
    case 'magic':
      return 'Magic'
    case 'rumor':
      return 'Rumor'
    case 'organization':
      return 'Organization'
    case 'misc':
      return 'Misc'
  }
}

export function normaliseTags(tags: ReadonlyArray<string>): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of tags) {
    const t = raw.trim().toLowerCase()
    if (!t) continue
    if (seen.has(t)) continue
    seen.add(t)
    out.push(t)
  }
  return out
}

export function matchesTag(entry: LoreEntry, tag: string): boolean {
  const needle = tag.trim().toLowerCase()
  if (!needle) return false
  return entry.tags.some((t) => t.toLowerCase() === needle)
}

export function freeTextMatches(entry: LoreEntry, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  if (entry.title.toLowerCase().includes(q)) return true
  if (entry.body.toLowerCase().includes(q)) return true
  return entry.tags.some((t) => t.toLowerCase().includes(q))
}
