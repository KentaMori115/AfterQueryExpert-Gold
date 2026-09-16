import { z } from 'zod'

import type { ArcId, CampaignId, FactionId } from '../ids'
import type { ISOTimestamp } from '../time/timestamps'

export type ArcStatus = 'seeded' | 'active' | 'climbing' | 'resolved' | 'shelved'

export const ARC_STATUSES: ReadonlyArray<ArcStatus> = [
  'seeded',
  'active',
  'climbing',
  'resolved',
  'shelved',
]

export type ArcTension = 'low' | 'rising' | 'high' | 'breaking'

export const ARC_TENSIONS: ReadonlyArray<ArcTension> = ['low', 'rising', 'high', 'breaking']

export interface Arc {
  id: ArcId
  campaignId: CampaignId
  title: string
  synopsis: string
  status: ArcStatus
  tension: ArcTension
  primaryFactionId: FactionId | null
  rivalFactionId: FactionId | null
  notes: string
  createdAt: ISOTimestamp
  updatedAt: ISOTimestamp
}

export interface ArcDraft {
  campaignId: CampaignId
  title: string
  synopsis?: string
  status?: ArcStatus
  tension?: ArcTension
  primaryFactionId?: FactionId | null
  rivalFactionId?: FactionId | null
  notes?: string
}

export const arcDraftSchema = z.object({
  campaignId: z.string().min(1),
  title: z.string().trim().min(1, 'title is required').max(160, 'title too long'),
  synopsis: z.string().max(1024, 'synopsis too long').optional(),
  status: z.enum(['seeded', 'active', 'climbing', 'resolved', 'shelved']).optional(),
  tension: z.enum(['low', 'rising', 'high', 'breaking']).optional(),
  primaryFactionId: z.string().nullable().optional(),
  rivalFactionId: z.string().nullable().optional(),
  notes: z.string().max(4096, 'notes too long').optional(),
})

export type ArcDraftInput = z.input<typeof arcDraftSchema>

export function statusLabel(s: ArcStatus): string {
  switch (s) {
    case 'seeded':
      return 'Seeded'
    case 'active':
      return 'Active'
    case 'climbing':
      return 'Climbing'
    case 'resolved':
      return 'Resolved'
    case 'shelved':
      return 'Shelved'
  }
}

export function statusTone(s: ArcStatus): 'success' | 'warning' | 'danger' | 'info' | 'neutral' {
  switch (s) {
    case 'active':
      return 'success'
    case 'climbing':
      return 'warning'
    case 'resolved':
      return 'info'
    case 'shelved':
      return 'neutral'
    default:
      return 'neutral'
  }
}

export function tensionLabel(t: ArcTension): string {
  switch (t) {
    case 'low':
      return 'Low'
    case 'rising':
      return 'Rising'
    case 'high':
      return 'High'
    case 'breaking':
      return 'Breaking'
  }
}

export function tensionBar(t: ArcTension): number {
  switch (t) {
    case 'low':
      return 25
    case 'rising':
      return 50
    case 'high':
      return 75
    case 'breaking':
      return 100
  }
}

export function isLive(arc: Arc): boolean {
  return arc.status !== 'resolved' && arc.status !== 'shelved'
}

export function statusColumns(): ReadonlyArray<{ status: ArcStatus; label: string }> {
  return [
    { status: 'seeded', label: statusLabel('seeded') },
    { status: 'active', label: statusLabel('active') },
    { status: 'climbing', label: statusLabel('climbing') },
    { status: 'resolved', label: statusLabel('resolved') },
    { status: 'shelved', label: statusLabel('shelved') },
  ]
}
