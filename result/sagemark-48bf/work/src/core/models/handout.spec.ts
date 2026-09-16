import { describe, expect, it } from 'vitest'

import { asCampaignId } from '../ids'
import { asTimestamp } from '../time/timestamps'

import {
  HANDOUT_KINDS,
  HANDOUT_VISIBILITIES,
  type Handout,
  handoutDraftSchema,
  isShareable,
  isShared,
  kindLabel,
  recipientLine,
  visibilityLabel,
  visibilityTone,
} from './handout'

function build(over: Partial<Handout> = {}): Handout {
  return {
    id: 'hd_X',
    campaignId: asCampaignId('camp_X'),
    title: 'The frost letter',
    body: 'words on the page',
    kind: 'letter',
    visibility: 'draft',
    signature: 'Iris',
    recipients: [],
    createdAt: asTimestamp('2026-04-01T10:00:00Z'),
    updatedAt: asTimestamp('2026-04-01T10:00:00Z'),
    sharedAt: null,
    ...over,
  }
}

describe('constants and labels', () => {
  it('lists kinds and visibilities', () => {
    expect(HANDOUT_KINDS).toContain('letter')
    expect(HANDOUT_VISIBILITIES).toEqual(['draft', 'shared', 'archived'])
  })

  it('labels every kind', () => {
    for (const k of HANDOUT_KINDS) {
      expect(kindLabel(k).length).toBeGreaterThan(0)
    }
  })

  it.each([
    ['draft', 'Draft'],
    ['shared', 'Shared'],
    ['archived', 'Archived'],
  ] as const)('visibilityLabel %s gives %s', (v, expected) => {
    expect(visibilityLabel(v)).toBe(expected)
  })

  it.each([
    ['draft', 'neutral'],
    ['shared', 'success'],
    ['archived', 'info'],
  ] as const)('visibilityTone %s gives %s', (v, expected) => {
    expect(visibilityTone(v)).toBe(expected)
  })
})

describe('shareable predicates', () => {
  it('isShareable true for draft and archived', () => {
    expect(isShareable(build({ visibility: 'draft' }))).toBe(true)
    expect(isShareable(build({ visibility: 'archived' }))).toBe(true)
    expect(isShareable(build({ visibility: 'shared' }))).toBe(false)
  })

  it('isShared only for shared visibility', () => {
    expect(isShared(build({ visibility: 'shared' }))).toBe(true)
    expect(isShared(build({ visibility: 'draft' }))).toBe(false)
  })
})

describe('recipientLine', () => {
  it('reports none', () => {
    expect(recipientLine(build({ recipients: [] }))).toBe('no recipients yet')
  })

  it('reports one', () => {
    expect(recipientLine(build({ recipients: ['Iris'] }))).toBe('for Iris')
  })

  it('reports two', () => {
    expect(recipientLine(build({ recipients: ['Iris', 'Brann'] }))).toBe('for Iris and Brann')
  })

  it('reports three or more with comma and an and', () => {
    expect(recipientLine(build({ recipients: ['Iris', 'Brann', 'Cael'] }))).toBe(
      'for Iris, Brann and Cael',
    )
  })
})

describe('handoutDraftSchema', () => {
  it('accepts a minimal draft', () => {
    const r = handoutDraftSchema.safeParse({ campaignId: 'camp_X', title: 'X' })
    expect(r.success).toBe(true)
  })

  it('rejects empty title', () => {
    const r = handoutDraftSchema.safeParse({ campaignId: 'camp_X', title: '   ' })
    expect(r.success).toBe(false)
  })

  it('rejects an unknown kind', () => {
    const r = handoutDraftSchema.safeParse({ campaignId: 'camp_X', title: 'X', kind: 'tome' })
    expect(r.success).toBe(false)
  })

  it('rejects too many recipients', () => {
    const recipients = Array.from({ length: 60 }, (_, i) => `r${i}`)
    const r = handoutDraftSchema.safeParse({ campaignId: 'camp_X', title: 'X', recipients })
    expect(r.success).toBe(false)
  })
})
