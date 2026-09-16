import { describe, expect, it } from 'vitest'

import { asCampaignId, asFactionId } from '../ids'
import { asTimestamp } from '../time/timestamps'

import {
  type InfluenceSnapshot,
  buildSparklinePath,
  buildSparklinePoints,
  lastInfluence,
  snapshotDraftSchema,
  sortAscByDate,
  trendDirection,
} from './influence-snapshot'

function snap(value: number, when: string): InfluenceSnapshot {
  return {
    id: 'sn_' + when,
    campaignId: asCampaignId('camp_X'),
    factionId: asFactionId('fac_X'),
    influence: value,
    recordedAt: asTimestamp(when),
    note: '',
  }
}

describe('sortAscByDate and lastInfluence', () => {
  it('sorts oldest first', () => {
    const order = sortAscByDate([
      snap(40, '2026-03-01'),
      snap(20, '2026-01-01'),
      snap(30, '2026-02-01'),
    ]).map((s) => s.influence)
    expect(order).toEqual([20, 30, 40])
  })

  it('lastInfluence picks the latest', () => {
    const last = lastInfluence([snap(20, '2026-01-01'), snap(40, '2026-03-01')])
    expect(last?.influence).toBe(40)
  })

  it('lastInfluence returns null when empty', () => {
    expect(lastInfluence([])).toBeNull()
  })
})

describe('trendDirection', () => {
  it('returns unknown for empty or single snapshot', () => {
    expect(trendDirection([])).toBe('unknown')
    expect(trendDirection([snap(30, '2026-01-01')])).toBe('unknown')
  })

  it('detects rising trends', () => {
    expect(trendDirection([snap(20, '2026-01-01'), snap(70, '2026-02-01')])).toBe('rising')
  })

  it('detects falling trends', () => {
    expect(trendDirection([snap(70, '2026-01-01'), snap(20, '2026-02-01')])).toBe('falling')
  })

  it('detects flat trends', () => {
    expect(trendDirection([snap(30, '2026-01-01'), snap(30, '2026-02-01')])).toBe('flat')
  })
})

describe('buildSparklinePoints and path', () => {
  it('returns one centered point for a single snapshot', () => {
    const points = buildSparklinePoints([snap(50, '2026-01-01')], 100, 40)
    expect(points).toHaveLength(1)
    expect(points[0]?.x).toBe(50)
    expect(points[0]?.y).toBe(20)
  })

  it('spreads points evenly along width', () => {
    const points = buildSparklinePoints(
      [snap(0, '2026-01-01'), snap(100, '2026-02-01'), snap(50, '2026-03-01')],
      100,
      40,
    )
    expect(points.map((p) => p.x)).toEqual([0, 50, 100])
    expect(points.map((p) => p.y)).toEqual([40, 0, 20])
  })

  it('buildSparklinePath produces an M and L sequence', () => {
    const points = buildSparklinePoints(
      [snap(20, '2026-01-01'), snap(40, '2026-02-01')],
      100,
      40,
    )
    const path = buildSparklinePath(points)
    expect(path.startsWith('M ')).toBe(true)
    expect(path).toContain(' L ')
  })

  it('buildSparklinePath of empty is empty', () => {
    expect(buildSparklinePath([])).toBe('')
  })
})

describe('snapshotDraftSchema', () => {
  it('accepts a valid draft', () => {
    const r = snapshotDraftSchema.safeParse({
      campaignId: 'camp_X',
      factionId: 'fac_X',
      influence: 50,
    })
    expect(r.success).toBe(true)
  })

  it('rejects out of range influence', () => {
    expect(
      snapshotDraftSchema.safeParse({ campaignId: 'c', factionId: 'f', influence: -1 }).success,
    ).toBe(false)
    expect(
      snapshotDraftSchema.safeParse({ campaignId: 'c', factionId: 'f', influence: 200 }).success,
    ).toBe(false)
  })

  it('rejects a fractional influence', () => {
    expect(
      snapshotDraftSchema.safeParse({ campaignId: 'c', factionId: 'f', influence: 50.5 }).success,
    ).toBe(false)
  })
})
