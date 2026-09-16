import { z } from 'zod'

import type { CampaignId, FactionId } from '../ids'
import type { ISOTimestamp } from '../time/timestamps'

export interface InfluenceSnapshot {
  id: string
  campaignId: CampaignId
  factionId: FactionId
  influence: number
  recordedAt: ISOTimestamp
  note: string
}

export interface SnapshotDraft {
  campaignId: CampaignId
  factionId: FactionId
  influence: number
  note?: string
}

export const snapshotDraftSchema = z.object({
  campaignId: z.string().min(1),
  factionId: z.string().min(1),
  influence: z.number().int().min(0).max(100),
  note: z.string().max(200, 'note too long').optional(),
})

export type SnapshotDraftInput = z.input<typeof snapshotDraftSchema>

export function sortAscByDate(snapshots: ReadonlyArray<InfluenceSnapshot>): InfluenceSnapshot[] {
  return [...snapshots].sort((a, b) => a.recordedAt.localeCompare(b.recordedAt))
}

export function lastInfluence(
  snapshots: ReadonlyArray<InfluenceSnapshot>,
): InfluenceSnapshot | null {
  if (snapshots.length === 0) return null
  return sortAscByDate(snapshots)[snapshots.length - 1] ?? null
}

export function trendDirection(
  snapshots: ReadonlyArray<InfluenceSnapshot>,
): 'rising' | 'falling' | 'flat' | 'unknown' {
  const sorted = sortAscByDate(snapshots)
  if (sorted.length < 2) return 'unknown'
  const first = sorted[0]!.influence
  const last = sorted[sorted.length - 1]!.influence
  if (last > first) return 'rising'
  if (last < first) return 'falling'
  return 'flat'
}

export interface SparklinePoint {
  x: number
  y: number
  influence: number
  recordedAt: ISOTimestamp
}

export function buildSparklinePoints(
  snapshots: ReadonlyArray<InfluenceSnapshot>,
  width: number,
  height: number,
): SparklinePoint[] {
  const sorted = sortAscByDate(snapshots)
  if (sorted.length === 0) return []
  if (sorted.length === 1) {
    const only = sorted[0]!
    return [
      {
        x: width / 2,
        y: height - (only.influence / 100) * height,
        influence: only.influence,
        recordedAt: only.recordedAt,
      },
    ]
  }
  const step = width / (sorted.length - 1)
  return sorted.map((s, i) => ({
    x: i * step,
    y: height - (s.influence / 100) * height,
    influence: s.influence,
    recordedAt: s.recordedAt,
  }))
}

export function buildSparklinePath(points: ReadonlyArray<SparklinePoint>): string {
  if (points.length === 0) return ''
  return points
    .map((p, i) => (i === 0 ? `M ${p.x.toFixed(1)} ${p.y.toFixed(1)}` : `L ${p.x.toFixed(1)} ${p.y.toFixed(1)}`))
    .join(' ')
}
