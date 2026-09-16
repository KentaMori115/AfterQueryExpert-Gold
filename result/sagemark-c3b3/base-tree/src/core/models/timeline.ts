import { z } from 'zod'

import type { CampaignId, TimelineEventId } from '../ids'
import type { ISOTimestamp } from '../time/timestamps'

export type TimelineEra = 'before-recorded' | 'antiquity' | 'classical' | 'middle' | 'present' | 'future'

export const TIMELINE_ERAS: ReadonlyArray<TimelineEra> = [
  'before-recorded',
  'antiquity',
  'classical',
  'middle',
  'present',
  'future',
]

export type TimelineSignificance = 'minor' | 'notable' | 'major' | 'world-shifting'

export const TIMELINE_SIGNIFICANCES: ReadonlyArray<TimelineSignificance> = [
  'minor',
  'notable',
  'major',
  'world-shifting',
]

export interface InWorldDate {
  year: number
  // optional fields for finer-grained dates
  month?: number | null
  day?: number | null
}

export interface TimelineEvent {
  id: TimelineEventId
  campaignId: CampaignId
  title: string
  description: string
  date: InWorldDate
  era: TimelineEra
  significance: TimelineSignificance
  revealed: boolean
  createdAt: ISOTimestamp
  updatedAt: ISOTimestamp
}

export interface TimelineDraft {
  campaignId: CampaignId
  title: string
  description?: string
  date: InWorldDate
  era?: TimelineEra
  significance?: TimelineSignificance
  revealed?: boolean
}

const dateSchema = z.object({
  year: z.number().int().min(-99_999, 'year too small').max(99_999, 'year too large'),
  month: z.number().int().min(1, 'month 1-13').max(13, 'month 1-13').nullable().optional(),
  day: z.number().int().min(1, 'day 1-31').max(31, 'day 1-31').nullable().optional(),
})

export const timelineDraftSchema = z.object({
  campaignId: z.string().min(1),
  title: z.string().trim().min(1, 'title is required').max(160, 'title too long'),
  description: z.string().max(2048, 'description too long').optional(),
  date: dateSchema,
  era: z.enum(['before-recorded', 'antiquity', 'classical', 'middle', 'present', 'future']).optional(),
  significance: z.enum(['minor', 'notable', 'major', 'world-shifting']).optional(),
  revealed: z.boolean().optional(),
})

export type TimelineDraftInput = z.input<typeof timelineDraftSchema>

export function eraLabel(e: TimelineEra): string {
  switch (e) {
    case 'before-recorded':
      return 'Before Recorded'
    case 'antiquity':
      return 'Antiquity'
    case 'classical':
      return 'Classical'
    case 'middle':
      return 'Middle Ages'
    case 'present':
      return 'Present'
    case 'future':
      return 'Future'
  }
}

export function significanceLabel(s: TimelineSignificance): string {
  switch (s) {
    case 'minor':
      return 'Minor'
    case 'notable':
      return 'Notable'
    case 'major':
      return 'Major'
    case 'world-shifting':
      return 'World-shifting'
  }
}

export function significanceWeight(s: TimelineSignificance): number {
  switch (s) {
    case 'minor':
      return 1
    case 'notable':
      return 2
    case 'major':
      return 3
    case 'world-shifting':
      return 4
  }
}

export function compareDates(a: InWorldDate, b: InWorldDate): number {
  if (a.year !== b.year) return a.year - b.year
  const am = a.month ?? 0
  const bm = b.month ?? 0
  if (am !== bm) return am - bm
  const ad = a.day ?? 0
  const bd = b.day ?? 0
  return ad - bd
}

export function formatInWorldDate(d: InWorldDate, opts: { yearSuffix?: string } = {}): string {
  const suffix = opts.yearSuffix ?? ''
  if (d.month && d.day) return `${pad(d.month)}/${pad(d.day)}/${d.year}${suffix}`
  if (d.month) return `m${d.month}, ${d.year}${suffix}`
  return `${d.year}${suffix}`
}

function pad(n: number): string {
  return n.toString().padStart(2, '0')
}

export function sortChronologically(events: ReadonlyArray<TimelineEvent>): TimelineEvent[] {
  return [...events].sort((a, b) => compareDates(a.date, b.date))
}

export function groupByEra(events: ReadonlyArray<TimelineEvent>): Record<TimelineEra, TimelineEvent[]> {
  const out = {} as Record<TimelineEra, TimelineEvent[]>
  for (const e of TIMELINE_ERAS) out[e] = []
  for (const ev of events) out[ev.era].push(ev)
  for (const era of TIMELINE_ERAS) {
    out[era] = sortChronologically(out[era])
  }
  return out
}
