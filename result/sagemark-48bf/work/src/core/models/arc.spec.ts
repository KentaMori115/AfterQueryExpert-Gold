import { describe, expect, it } from 'vitest'

import { asArcId, asCampaignId } from '../ids'
import { asTimestamp } from '../time/timestamps'

import {
  ARC_STATUSES,
  ARC_TENSIONS,
  type Arc,
  arcDraftSchema,
  isLive,
  statusColumns,
  statusLabel,
  statusTone,
  tensionBar,
  tensionLabel,
} from './arc'

function build(over: Partial<Arc> = {}): Arc {
  return {
    id: asArcId('arc_TEST'),
    campaignId: asCampaignId('camp_TEST'),
    title: 'The Long Winter',
    synopsis: '',
    status: 'active',
    tension: 'rising',
    primaryFactionId: null,
    rivalFactionId: null,
    notes: '',
    createdAt: asTimestamp('2025-04-01'),
    updatedAt: asTimestamp('2025-04-01'),
    ...over,
  }
}

describe('constants', () => {
  it('lists statuses', () => {
    expect(ARC_STATUSES).toContain('active')
    expect(ARC_STATUSES).toHaveLength(5)
  })
  it('lists tensions', () => {
    expect(ARC_TENSIONS).toContain('breaking')
  })
})

describe('labels and tones', () => {
  it.each([
    ['seeded', 'Seeded'],
    ['active', 'Active'],
    ['climbing', 'Climbing'],
    ['resolved', 'Resolved'],
    ['shelved', 'Shelved'],
  ] as const)('labels status %s -> %s', (s, expected) => {
    expect(statusLabel(s)).toBe(expected)
  })

  it.each([
    ['active', 'success'],
    ['climbing', 'warning'],
    ['resolved', 'info'],
    ['shelved', 'neutral'],
    ['seeded', 'neutral'],
  ] as const)('tones status %s -> %s', (s, expected) => {
    expect(statusTone(s)).toBe(expected)
  })

  it.each([
    ['low', 'Low'],
    ['rising', 'Rising'],
    ['high', 'High'],
    ['breaking', 'Breaking'],
  ] as const)('labels tension %s -> %s', (t, expected) => {
    expect(tensionLabel(t)).toBe(expected)
  })

  it.each([
    ['low', 25],
    ['rising', 50],
    ['high', 75],
    ['breaking', 100],
  ] as const)('tensionBar %s -> %d', (t, expected) => {
    expect(tensionBar(t)).toBe(expected)
  })
})

describe('isLive', () => {
  it('returns true for in-play statuses', () => {
    expect(isLive(build({ status: 'seeded' }))).toBe(true)
    expect(isLive(build({ status: 'active' }))).toBe(true)
    expect(isLive(build({ status: 'climbing' }))).toBe(true)
  })

  it('returns false for resolved or shelved', () => {
    expect(isLive(build({ status: 'resolved' }))).toBe(false)
    expect(isLive(build({ status: 'shelved' }))).toBe(false)
  })
})

describe('statusColumns', () => {
  it('returns columns in narrative order', () => {
    const cols = statusColumns()
    expect(cols.map((c) => c.status)).toEqual([
      'seeded',
      'active',
      'climbing',
      'resolved',
      'shelved',
    ])
  })
})

describe('arcDraftSchema', () => {
  it('accepts a valid draft', () => {
    expect(arcDraftSchema.safeParse({ campaignId: 'c', title: 'X' }).success).toBe(true)
  })
  it('rejects empty title', () => {
    expect(arcDraftSchema.safeParse({ campaignId: 'c', title: '  ' }).success).toBe(false)
  })
  it('rejects unknown status', () => {
    expect(arcDraftSchema.safeParse({ campaignId: 'c', title: 'X', status: 'mystery' }).success).toBe(false)
  })
  it('rejects unknown tension', () => {
    expect(arcDraftSchema.safeParse({ campaignId: 'c', title: 'X', tension: 'crushing' }).success).toBe(false)
  })
})
