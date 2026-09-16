import { z } from 'zod'

import type { CampaignId } from '../ids'
import type { ISOTimestamp } from '../time/timestamps'

export type HolidayKind = 'feast' | 'memorial' | 'market' | 'sacred' | 'civic' | 'season'

export const HOLIDAY_KINDS: ReadonlyArray<HolidayKind> = [
  'feast',
  'memorial',
  'market',
  'sacred',
  'civic',
  'season',
]

const KIND_LABELS: Record<HolidayKind, string> = {
  feast: 'Feast',
  memorial: 'Memorial',
  market: 'Market day',
  sacred: 'Sacred day',
  civic: 'Civic',
  season: 'Season turn',
}

const KIND_TONES: Record<HolidayKind, 'info' | 'success' | 'warning' | 'danger' | 'neutral'> = {
  feast: 'success',
  memorial: 'neutral',
  market: 'info',
  sacred: 'warning',
  civic: 'info',
  season: 'success',
}

export function holidayKindLabel(k: HolidayKind): string {
  return KIND_LABELS[k]
}

export function holidayKindTone(
  k: HolidayKind,
): 'info' | 'success' | 'warning' | 'danger' | 'neutral' {
  return KIND_TONES[k]
}

export interface Holiday {
  id: string
  campaignId: CampaignId
  name: string
  month: number
  day: number
  kind: HolidayKind
  observance: string
  createdAt: ISOTimestamp
  updatedAt: ISOTimestamp
}

export interface HolidayDraft {
  campaignId: CampaignId
  name: string
  month: number
  day: number
  kind?: HolidayKind
  observance?: string
}

export const holidayDraftSchema = z.object({
  campaignId: z.string().min(1),
  name: z.string().trim().min(1).max(120),
  month: z.number().int().min(1).max(36),
  day: z.number().int().min(1).max(60),
  kind: z.enum(HOLIDAY_KINDS as unknown as [HolidayKind, ...HolidayKind[]]).optional(),
  observance: z.string().max(400).optional(),
})

export function compareByDate(a: Holiday, b: Holiday): number {
  if (a.month !== b.month) return a.month - b.month
  if (a.day !== b.day) return a.day - b.day
  return a.name.localeCompare(b.name)
}

export function nextUpcoming(
  holidays: ReadonlyArray<Holiday>,
  shape: { monthsPerYear: number; daysPerMonth: number },
  from: { month: number; day: number },
  count = 3,
): Holiday[] {
  const fromOrd = (from.month - 1) * shape.daysPerMonth + (from.day - 1)
  const withOrd = holidays.map((h) => ({
    h,
    ord: (h.month - 1) * shape.daysPerMonth + (h.day - 1),
  }))
  const after = withOrd.filter((entry) => entry.ord >= fromOrd).sort((a, b) => a.ord - b.ord)
  const before = withOrd.filter((entry) => entry.ord < fromOrd).sort((a, b) => a.ord - b.ord)
  return [...after, ...before].slice(0, count).map((entry) => entry.h)
}
