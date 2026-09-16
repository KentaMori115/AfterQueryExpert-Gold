import { describe, expect, it } from 'vitest'

import { asCampaignId, asCharacterId, asNoteId } from '../ids'
import { asTimestamp } from '../time/timestamps'

import {
  NOTE_PRIORITIES,
  NOTE_TARGET_KINDS,
  type Note,
  compareNotesForListing,
  isOverdue,
  isResolved,
  noteDraftSchema,
  priorityLabel,
  priorityTone,
  priorityWeight,
  targetLabel,
} from './note'

function build(over: Partial<Note> = {}): Note {
  return {
    id: asNoteId('not_TEST'),
    campaignId: asCampaignId('camp_TEST'),
    target: { kind: 'character', id: asCharacterId('char_A') },
    title: 'Watch the candles',
    body: 'Snuff them before midnight',
    priority: 'normal',
    pinned: false,
    remindAt: null,
    resolvedAt: null,
    createdAt: asTimestamp('2025-12-10T20:00:00Z'),
    updatedAt: asTimestamp('2025-12-10T20:00:00Z'),
    ...over,
  }
}

describe('constants and labels', () => {
  it('lists target kinds and priorities', () => {
    expect(NOTE_TARGET_KINDS).toContain('lore')
    expect(NOTE_TARGET_KINDS).toContain('quest')
    expect(NOTE_PRIORITIES).toContain('critical')
  })

  it.each([
    ['low', 'Low'],
    ['normal', 'Normal'],
    ['high', 'High'],
    ['critical', 'Critical'],
  ] as const)('priorityLabel %s gives %s', (p, expected) => {
    expect(priorityLabel(p)).toBe(expected)
  })

  it.each([
    ['low', 'neutral'],
    ['normal', 'info'],
    ['high', 'warning'],
    ['critical', 'danger'],
  ] as const)('priorityTone %s gives %s', (p, expected) => {
    expect(priorityTone(p)).toBe(expected)
  })

  it.each([
    ['low', 1],
    ['normal', 2],
    ['high', 3],
    ['critical', 4],
  ] as const)('priorityWeight %s gives %d', (p, expected) => {
    expect(priorityWeight(p)).toBe(expected)
  })

  it('labels target kinds', () => {
    for (const k of NOTE_TARGET_KINDS) {
      expect(targetLabel(k).length).toBeGreaterThan(0)
    }
    expect(targetLabel('location')).toBe('Place')
  })
})

describe('isResolved and isOverdue', () => {
  it('isResolved tracks the resolvedAt field', () => {
    expect(isResolved(build())).toBe(false)
    expect(isResolved(build({ resolvedAt: asTimestamp('2025-12-11T10:00:00Z') }))).toBe(true)
  })

  it('isOverdue returns false when there is no remindAt', () => {
    expect(isOverdue(build({ remindAt: null }))).toBe(false)
  })

  it('isOverdue returns false when resolved already', () => {
    const note = build({
      remindAt: asTimestamp('2025-12-09T10:00:00Z'),
      resolvedAt: asTimestamp('2025-12-09T11:00:00Z'),
    })
    expect(isOverdue(note, new Date('2025-12-12T10:00:00Z'))).toBe(false)
  })

  it('isOverdue returns true when remindAt is in the past and not resolved', () => {
    const note = build({ remindAt: asTimestamp('2025-12-09T10:00:00Z') })
    expect(isOverdue(note, new Date('2025-12-10T10:00:00Z'))).toBe(true)
  })

  it('isOverdue returns false when remindAt is still in the future', () => {
    const note = build({ remindAt: asTimestamp('2025-12-15T10:00:00Z') })
    expect(isOverdue(note, new Date('2025-12-10T10:00:00Z'))).toBe(false)
  })
})

describe('compareNotesForListing', () => {
  it('pinned notes float above unpinned', () => {
    const pinned = build({ id: asNoteId('not_A'), pinned: true })
    const plain = build({ id: asNoteId('not_B'), pinned: false })
    const ordered = [plain, pinned].sort(compareNotesForListing)
    expect(ordered[0]?.id).toBe(pinned.id)
  })

  it('resolved sink below open notes', () => {
    const open = build({ id: asNoteId('not_A') })
    const resolved = build({ id: asNoteId('not_B'), resolvedAt: asTimestamp('2025-12-11') })
    const ordered = [resolved, open].sort(compareNotesForListing)
    expect(ordered[0]?.id).toBe(open.id)
  })

  it('higher priority comes first among open notes', () => {
    const low = build({ id: asNoteId('low'), priority: 'low' })
    const crit = build({ id: asNoteId('crit'), priority: 'critical' })
    const ordered = [low, crit].sort(compareNotesForListing)
    expect(ordered[0]?.id).toBe(crit.id)
  })

  it('within same priority, newest first', () => {
    const older = build({ id: asNoteId('old'), createdAt: asTimestamp('2025-12-01') })
    const newer = build({ id: asNoteId('new'), createdAt: asTimestamp('2025-12-09') })
    const ordered = [older, newer].sort(compareNotesForListing)
    expect(ordered[0]?.id).toBe(newer.id)
  })
})

describe('noteDraftSchema', () => {
  it('accepts a minimal valid draft', () => {
    const r = noteDraftSchema.safeParse({
      campaignId: 'camp_X',
      target: { kind: 'character', id: 'char_A' },
      body: 'hello there',
    })
    expect(r.success).toBe(true)
  })

  it('rejects empty body', () => {
    const r = noteDraftSchema.safeParse({
      campaignId: 'camp_X',
      target: { kind: 'character', id: 'char_A' },
      body: '   ',
    })
    expect(r.success).toBe(false)
  })

  it('rejects an unknown target kind', () => {
    const r = noteDraftSchema.safeParse({
      campaignId: 'camp_X',
      target: { kind: 'dragon', id: 'd1' },
      body: 'something',
    })
    expect(r.success).toBe(false)
  })

  it('rejects unparseable remindAt strings', () => {
    const r = noteDraftSchema.safeParse({
      campaignId: 'camp_X',
      target: { kind: 'character', id: 'char_A' },
      body: 'something',
      remindAt: 'tomorrow',
    })
    expect(r.success).toBe(false)
  })

  it('accepts null remindAt', () => {
    const r = noteDraftSchema.safeParse({
      campaignId: 'camp_X',
      target: { kind: 'character', id: 'char_A' },
      body: 'something',
      remindAt: null,
    })
    expect(r.success).toBe(true)
  })
})
