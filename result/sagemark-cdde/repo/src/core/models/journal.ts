import { z } from 'zod'

import type { ISOTimestamp } from '../time/timestamps'

export type JournalMood = 'fired-up' | 'steady' | 'tired' | 'frustrated' | 'curious' | 'inspired'

export const JOURNAL_MOODS: ReadonlyArray<JournalMood> = [
  'fired-up',
  'steady',
  'tired',
  'frustrated',
  'curious',
  'inspired',
]

const MOOD_LABELS: Record<JournalMood, string> = {
  'fired-up': 'Fired up',
  steady: 'Steady',
  tired: 'Tired',
  frustrated: 'Frustrated',
  curious: 'Curious',
  inspired: 'Inspired',
}

const MOOD_TONES: Record<JournalMood, 'success' | 'info' | 'neutral' | 'warning' | 'danger'> = {
  'fired-up': 'success',
  steady: 'info',
  tired: 'neutral',
  frustrated: 'warning',
  curious: 'info',
  inspired: 'success',
}

export function moodLabel(m: JournalMood): string {
  return MOOD_LABELS[m]
}

export function moodTone(m: JournalMood): 'success' | 'info' | 'neutral' | 'warning' | 'danger' {
  return MOOD_TONES[m]
}

export interface JournalEntry {
  id: string
  campaignId: string | null
  title: string
  body: string
  mood: JournalMood
  pinned: boolean
  createdAt: ISOTimestamp
  updatedAt: ISOTimestamp
}

export interface JournalEntryDraft {
  campaignId?: string | null
  title: string
  body: string
  mood?: JournalMood
  pinned?: boolean
}

export const journalEntryDraftSchema = z.object({
  campaignId: z.string().nullable().optional(),
  title: z.string().trim().min(1).max(160),
  body: z.string().trim().min(1).max(4000),
  mood: z.enum(JOURNAL_MOODS as unknown as [JournalMood, ...JournalMood[]]).optional(),
  pinned: z.boolean().optional(),
})

export function compareForListing(a: JournalEntry, b: JournalEntry): number {
  if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
  if (a.createdAt < b.createdAt) return 1
  if (a.createdAt > b.createdAt) return -1
  return 0
}

export function moodStreak(entries: ReadonlyArray<JournalEntry>): JournalMood | null {
  const recent = [...entries].sort(compareForListing).slice(0, 3)
  if (recent.length < 3) return null
  const all = recent.every((e) => e.mood === recent[0]!.mood)
  return all ? recent[0]!.mood : null
}
