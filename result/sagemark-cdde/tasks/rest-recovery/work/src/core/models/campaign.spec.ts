import { describe, expect, it } from 'vitest'

import { asCampaignId } from '../ids'
import { asTimestamp } from '../time/timestamps'

import {
  CAMPAIGN_STATUSES,
  CAMPAIGN_SYSTEMS,
  type Campaign,
  campaignDraftSchema,
  comparableSortKey,
  isClosed,
  isOpen,
  statusLabel,
  systemLabel,
} from './campaign'

function campaign(over: Partial<Campaign> = {}): Campaign {
  return {
    id: asCampaignId('camp_TEST123456'),
    name: 'The Frozen Gate',
    tagline: '',
    system: 'dnd5e',
    status: 'active',
    startedAt: asTimestamp('2025-01-01T10:00:00Z'),
    lastPlayedAt: asTimestamp('2025-04-12T22:30:00Z'),
    sessionCount: 12,
    createdAt: asTimestamp('2025-01-01T10:00:00Z'),
    updatedAt: asTimestamp('2025-04-12T22:30:00Z'),
    ...over,
  }
}

describe('CAMPAIGN_SYSTEMS / CAMPAIGN_STATUSES', () => {
  it('lists known values', () => {
    expect(CAMPAIGN_SYSTEMS).toContain('dnd5e')
    expect(CAMPAIGN_STATUSES).toContain('active')
  })
})

describe('systemLabel / statusLabel', () => {
  it.each([
    ['dnd5e', 'D&D 5e'],
    ['pf2e', 'Pathfinder 2e'],
    ['savage-worlds', 'Savage Worlds'],
    ['cypher', 'Cypher System'],
    ['custom', 'Custom'],
    ['other', 'Other'],
  ] as const)('labels system %s -> %s', (sys, expected) => {
    expect(systemLabel(sys)).toBe(expected)
  })

  it.each([
    ['planning', 'Planning'],
    ['active', 'Active'],
    ['paused', 'Paused'],
    ['finished', 'Finished'],
    ['archived', 'Archived'],
  ] as const)('labels status %s -> %s', (st, expected) => {
    expect(statusLabel(st)).toBe(expected)
  })
})

describe('isOpen / isClosed', () => {
  it('treats planning/active/paused as open', () => {
    expect(isOpen(campaign({ status: 'planning' }))).toBe(true)
    expect(isOpen(campaign({ status: 'active' }))).toBe(true)
    expect(isOpen(campaign({ status: 'paused' }))).toBe(true)
  })

  it('treats finished/archived as closed', () => {
    expect(isClosed(campaign({ status: 'finished' }))).toBe(true)
    expect(isClosed(campaign({ status: 'archived' }))).toBe(true)
    expect(isOpen(campaign({ status: 'finished' }))).toBe(false)
  })
})

describe('comparableSortKey', () => {
  it('places open campaigns before archived ones', () => {
    const open = campaign({ status: 'active', name: 'A' })
    const archived = campaign({ status: 'archived', name: 'B' })
    const sorted = [archived, open].sort((a, b) => comparableSortKey(a).localeCompare(comparableSortKey(b)))
    expect(sorted[0]?.name).toBe('A')
  })

  it('within a bucket, newer activity sorts first', () => {
    const older = campaign({
      lastPlayedAt: asTimestamp('2025-01-01T00:00:00Z'),
      updatedAt: asTimestamp('2025-01-01T00:00:00Z'),
      name: 'older',
    })
    const newer = campaign({
      lastPlayedAt: asTimestamp('2025-06-01T00:00:00Z'),
      updatedAt: asTimestamp('2025-06-01T00:00:00Z'),
      name: 'newer',
    })
    const sorted = [older, newer].sort((a, b) => comparableSortKey(a).localeCompare(comparableSortKey(b)))
    expect(sorted[0]?.name).toBe('newer')
  })
})

describe('campaignDraftSchema', () => {
  it('accepts a minimal valid draft', () => {
    const r = campaignDraftSchema.safeParse({ name: 'New Run' })
    expect(r.success).toBe(true)
  })

  it('rejects empty name', () => {
    const r = campaignDraftSchema.safeParse({ name: '   ' })
    expect(r.success).toBe(false)
    if (!r.success) {
      const issue = r.error.issues.find((i) => i.path.includes('name'))
      expect(issue?.message).toMatch(/required/)
    }
  })

  it('rejects a name that is too long', () => {
    const r = campaignDraftSchema.safeParse({ name: 'x'.repeat(200) })
    expect(r.success).toBe(false)
  })

  it('rejects an unknown system', () => {
    const r = campaignDraftSchema.safeParse({ name: 'ok', system: 'd6stars' })
    expect(r.success).toBe(false)
  })
})
