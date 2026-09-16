import { describe, expect, it } from 'vitest'

import { asCampaignId, asCharacterId, asSessionId } from '../ids'
import { asTimestamp } from '../time/timestamps'

import {
  type Session,
  attendanceRatio,
  durationLabel,
  nextNumber,
  sessionDraftSchema,
  sessionLabel,
  sortChronologically,
} from './session'

function build(over: Partial<Session> & { id?: string } = {}): Session {
  return {
    id: asSessionId(over.id ?? 'ses_TEST'),
    campaignId: asCampaignId('camp_TEST'),
    number: 1,
    title: 'The Frozen Inn',
    playedAt: asTimestamp('2025-03-01T20:00:00Z'),
    durationMinutes: 240,
    locationId: null,
    attendees: [],
    summary: '',
    log: '',
    createdAt: asTimestamp('2025-03-01T20:00:00Z'),
    updatedAt: asTimestamp('2025-03-01T20:00:00Z'),
    ...over,
    id: asSessionId(over.id ?? 'ses_TEST'),
  }
}

describe('sessionLabel', () => {
  it('combines number and title', () => {
    expect(sessionLabel(build({ number: 4, title: 'Frostbite' }))).toBe('Session 4 - Frostbite')
  })

  it('falls back to just the number when title is empty', () => {
    expect(sessionLabel(build({ number: 7, title: '' }))).toBe('Session 7')
  })
})

describe('durationLabel', () => {
  it.each([
    [0, 'no time recorded'],
    [30, '30m'],
    [45, '45m'],
    [60, '1h'],
    [90, '1h 30m'],
    [240, '4h'],
    [255, '4h 15m'],
  ] as const)('formats %d minutes as %s', (mins, expected) => {
    expect(durationLabel(mins)).toBe(expected)
  })
})

describe('attendanceRatio', () => {
  it('returns 0 when party size is 0 or negative', () => {
    expect(attendanceRatio(build({ attendees: [] }), 0)).toBe(0)
    expect(attendanceRatio(build({ attendees: [] }), -3)).toBe(0)
  })

  it('returns attendees / party size', () => {
    const s = build({ attendees: [asCharacterId('c1'), asCharacterId('c2')] })
    expect(attendanceRatio(s, 4)).toBe(0.5)
  })

  it('clamps to 1 when attendees exceeds party size', () => {
    const s = build({
      attendees: [asCharacterId('c1'), asCharacterId('c2'), asCharacterId('c3')],
    })
    expect(attendanceRatio(s, 2)).toBe(1)
  })
})

describe('sortChronologically', () => {
  it('sorts ascending by playedAt', () => {
    const a = build({ id: 'a', playedAt: asTimestamp('2025-04-01T00:00:00Z') })
    const b = build({ id: 'b', playedAt: asTimestamp('2025-03-01T00:00:00Z') })
    const c = build({ id: 'c', playedAt: asTimestamp('2025-05-01T00:00:00Z') })
    const sorted = sortChronologically([a, b, c])
    expect(sorted.map((s) => s.id)).toEqual([
      asSessionId('b'),
      asSessionId('a'),
      asSessionId('c'),
    ])
  })

  it('tiebreaks on session number when same playedAt', () => {
    const ts = asTimestamp('2025-04-01T00:00:00Z')
    const a = build({ id: 'a', number: 2, playedAt: ts })
    const b = build({ id: 'b', number: 1, playedAt: ts })
    const sorted = sortChronologically([a, b])
    expect(sorted[0]?.id).toBe(asSessionId('b'))
  })
})

describe('nextNumber', () => {
  it('returns 1 for empty input', () => {
    expect(nextNumber([])).toBe(1)
  })

  it('returns max+1', () => {
    expect(nextNumber([build({ number: 3 }), build({ number: 5 }), build({ number: 1 })])).toBe(6)
  })
})

describe('sessionDraftSchema', () => {
  it('accepts a valid draft', () => {
    const r = sessionDraftSchema.safeParse({
      campaignId: 'camp_1',
      title: 'X',
      playedAt: '2025-03-01T20:00:00Z',
    })
    expect(r.success).toBe(true)
  })

  it('rejects empty title', () => {
    const r = sessionDraftSchema.safeParse({
      campaignId: 'camp_1',
      title: '   ',
      playedAt: '2025-03-01T20:00:00Z',
    })
    expect(r.success).toBe(false)
  })

  it('rejects unparseable date', () => {
    const r = sessionDraftSchema.safeParse({
      campaignId: 'camp_1',
      title: 'X',
      playedAt: 'not-a-date',
    })
    expect(r.success).toBe(false)
  })

  it('rejects oversized duration', () => {
    const r = sessionDraftSchema.safeParse({
      campaignId: 'camp_1',
      title: 'X',
      playedAt: '2025-03-01T20:00:00Z',
      durationMinutes: 60 * 25,
    })
    expect(r.success).toBe(false)
  })
})
