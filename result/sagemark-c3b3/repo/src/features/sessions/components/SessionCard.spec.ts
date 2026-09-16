import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import { asCampaignId, asCharacterId, asSessionId } from '@core/ids'
import type { Session } from '@core/models/session'
import { asTimestamp } from '@core/time/timestamps'

import SessionCard from './SessionCard.vue'

function build(over: Partial<Session> = {}): Session {
  return {
    id: asSessionId('ses_TEST'),
    campaignId: asCampaignId('camp_TEST'),
    number: 4,
    title: 'Frostbitten Inn',
    playedAt: asTimestamp('2025-03-01T20:00:00Z'),
    durationMinutes: 180,
    locationId: null,
    attendees: [asCharacterId('char_a'), asCharacterId('char_b'), asCharacterId('char_c')],
    summary: 'They warmed up at the inn',
    log: '',
    createdAt: asTimestamp('2025-03-01T20:00:00Z'),
    updatedAt: asTimestamp('2025-03-01T20:00:00Z'),
    ...over,
  }
}

describe('SessionCard', () => {
  it('shows the session label', () => {
    const w = mount(SessionCard, { props: { session: build() } })
    expect(w.text()).toContain('Session 4')
    expect(w.text()).toContain('Frostbitten Inn')
  })

  it('formats duration', () => {
    const w = mount(SessionCard, { props: { session: build({ durationMinutes: 240 }) } })
    expect(w.text()).toContain('4h')
  })

  it('pluralises attendee count', () => {
    const w = mount(SessionCard, {
      props: { session: build({ attendees: [asCharacterId('a')] }) },
    })
    expect(w.text()).toContain('1 attendee')
  })

  it('shows the summary', () => {
    const w = mount(SessionCard, { props: { session: build() } })
    expect(w.text()).toContain('warmed up at the inn')
  })

  it('omits summary when empty', () => {
    const w = mount(SessionCard, { props: { session: build({ summary: '' }) } })
    expect(w.findAll('p').filter((p) => !p.text().includes('attendee'))).toHaveLength(1)
  })
})
