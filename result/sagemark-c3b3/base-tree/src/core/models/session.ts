import { z } from 'zod'

import type { CampaignId, CharacterId, LocationId, SessionId } from '../ids'
import type { ISOTimestamp } from '../time/timestamps'

export interface Session {
  id: SessionId
  campaignId: CampaignId
  number: number // 1-based ordinal within the campaign
  title: string
  playedAt: ISOTimestamp
  durationMinutes: number
  locationId: LocationId | null
  attendees: ReadonlyArray<CharacterId>
  summary: string
  log: string
  createdAt: ISOTimestamp
  updatedAt: ISOTimestamp
}

export interface SessionDraft {
  campaignId: CampaignId
  title: string
  playedAt: ISOTimestamp | string
  durationMinutes?: number
  locationId?: LocationId | null
  attendees?: ReadonlyArray<CharacterId>
  summary?: string
  log?: string
}

export const sessionDraftSchema = z.object({
  campaignId: z.string().min(1),
  title: z.string().trim().min(1, 'title is required').max(160, 'title too long'),
  playedAt: z.string().refine((v) => !Number.isNaN(Date.parse(v)), { message: 'playedAt must be a parseable date' }),
  durationMinutes: z.number().int().min(0, 'duration cannot be negative').max(60 * 24, 'duration is unreasonably long').optional(),
  locationId: z.string().nullable().optional(),
  attendees: z.array(z.string()).max(40, 'too many attendees').optional(),
  summary: z.string().max(512, 'summary too long').optional(),
  log: z.string().max(20_000, 'log too long').optional(),
})

export type SessionDraftInput = z.input<typeof sessionDraftSchema>

export function sessionLabel(s: Session): string {
  return `Session ${s.number}${s.title ? ' - ' + s.title : ''}`
}

export function durationLabel(minutes: number): string {
  if (minutes <= 0) return 'no time recorded'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60
  if (mins === 0) return `${hours}h`
  return `${hours}h ${mins}m`
}

export function attendanceRatio(s: Session, partySize: number): number {
  if (partySize <= 0) return 0
  const count = Math.min(s.attendees.length, partySize)
  return count / partySize
}

export function sortChronologically(sessions: ReadonlyArray<Session>): Session[] {
  return [...sessions].sort((a, b) => {
    if (a.playedAt === b.playedAt) return a.number - b.number
    return a.playedAt < b.playedAt ? -1 : 1
  })
}

export function nextNumber(sessions: ReadonlyArray<Session>): number {
  if (sessions.length === 0) return 1
  return sessions.reduce((max, s) => Math.max(max, s.number), 0) + 1
}
