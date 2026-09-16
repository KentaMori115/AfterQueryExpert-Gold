import { describe, expect, it } from 'vitest'

import { asTimestamp } from '../time/timestamps'

import {
  JOURNAL_MOODS,
  type JournalEntry,
  compareForListing,
  journalEntryDraftSchema,
  moodLabel,
  moodStreak,
  moodTone,
} from './journal'

function build(over: Partial<JournalEntry> = {}): JournalEntry {
  return {
    id: 'j_X',
    campaignId: 'camp_X',
    title: 'Pre-session',
    body: 'thinking about the bell',
    mood: 'fired-up',
    pinned: false,
    createdAt: asTimestamp('2026-04-01T10:00:00Z'),
    updatedAt: asTimestamp('2026-04-01T10:00:00Z'),
    ...over,
  }
}

describe('moods', () => {
  it('lists six moods with labels and tones', () => {
    expect(JOURNAL_MOODS.length).toBeGreaterThanOrEqual(5)
    for (const m of JOURNAL_MOODS) {
      expect(moodLabel(m).length).toBeGreaterThan(0)
      expect(typeof moodTone(m)).toBe('string')
    }
  })
})

describe('compareForListing', () => {
  it('puts pinned first then newest', () => {
    const a = build({ id: 'a', pinned: true, createdAt: asTimestamp('2026-01-01T10:00:00Z') })
    const b = build({ id: 'b', pinned: false, createdAt: asTimestamp('2026-06-01T10:00:00Z') })
    const c = build({ id: 'c', pinned: false, createdAt: asTimestamp('2026-03-01T10:00:00Z') })
    expect([b, a, c].sort(compareForListing).map((e) => e.id)).toEqual(['a', 'b', 'c'])
  })
})

describe('moodStreak', () => {
  it('returns the mood when the last three entries match', () => {
    const e = [
      build({ id: '1', mood: 'tired', createdAt: asTimestamp('2026-03-01T10:00:00Z') }),
      build({ id: '2', mood: 'tired', createdAt: asTimestamp('2026-04-01T10:00:00Z') }),
      build({ id: '3', mood: 'tired', createdAt: asTimestamp('2026-05-01T10:00:00Z') }),
    ]
    expect(moodStreak(e)).toBe('tired')
  })

  it('returns null when the moods differ', () => {
    const e = [
      build({ id: '1', mood: 'tired', createdAt: asTimestamp('2026-03-01T10:00:00Z') }),
      build({ id: '2', mood: 'steady', createdAt: asTimestamp('2026-04-01T10:00:00Z') }),
      build({ id: '3', mood: 'tired', createdAt: asTimestamp('2026-05-01T10:00:00Z') }),
    ]
    expect(moodStreak(e)).toBeNull()
  })

  it('returns null when fewer than three entries exist', () => {
    expect(moodStreak([build()])).toBeNull()
  })
})

describe('journalEntryDraftSchema', () => {
  it('accepts a clean draft', () => {
    expect(
      journalEntryDraftSchema.safeParse({
        campaignId: 'camp_X',
        title: 'Note',
        body: 'something',
      }).success,
    ).toBe(true)
  })

  it('rejects an empty title or body', () => {
    expect(journalEntryDraftSchema.safeParse({ title: '   ', body: 'x' }).success).toBe(false)
    expect(journalEntryDraftSchema.safeParse({ title: 'x', body: '   ' }).success).toBe(false)
  })

  it('rejects an unknown mood', () => {
    expect(
      journalEntryDraftSchema.safeParse({ title: 'A', body: 'B', mood: 'sad' }).success,
    ).toBe(false)
  })

  it('rejects very long bodies', () => {
    expect(
      journalEntryDraftSchema.safeParse({ title: 'A', body: 'x'.repeat(8000) }).success,
    ).toBe(false)
  })
})
