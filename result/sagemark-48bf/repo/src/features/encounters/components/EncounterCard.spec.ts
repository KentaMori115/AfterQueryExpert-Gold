import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import { asCampaignId, asEncounterId } from '@core/ids'
import type { Encounter } from '@core/models/encounter'
import { asTimestamp } from '@core/time/timestamps'

import EncounterCard from './EncounterCard.vue'

function build(over: Partial<Encounter> = {}): Encounter {
  return {
    id: asEncounterId('enc_X'),
    campaignId: asCampaignId('camp_X'),
    sessionId: null,
    locationId: null,
    title: 'Goblin Ambush',
    kind: 'combat',
    difficulty: 'hard',
    summary: 'Three goblins jump the party from the cover of fallen pines',
    initiative: [],
    resolved: false,
    createdAt: asTimestamp('2025-04-01'),
    updatedAt: asTimestamp('2025-04-01'),
    ...over,
  }
}

describe('EncounterCard', () => {
  it('shows title', () => {
    const w = mount(EncounterCard, { props: { encounter: build() } })
    expect(w.text()).toContain('Goblin Ambush')
  })

  it('shows kind label', () => {
    const w = mount(EncounterCard, { props: { encounter: build({ kind: 'social' }) } })
    expect(w.text()).toContain('Social')
  })

  it('shows difficulty badge', () => {
    const w = mount(EncounterCard, { props: { encounter: build({ difficulty: 'deadly' }) } })
    expect(w.text()).toContain('Deadly')
  })

  it('dims and labels resolved', () => {
    const w = mount(EncounterCard, { props: { encounter: build({ resolved: true }) } })
    expect(w.text()).toContain('resolved')
    expect(w.classes().join(' ')).toContain('opacity-60')
  })

  it('reports initiative count', () => {
    const w = mount(EncounterCard, {
      props: {
        encounter: build({
          initiative: [
            { characterId: null, name: 'g1', initiative: 10, hp: 5, notes: '' },
            { characterId: null, name: 'g2', initiative: 8, hp: 5, notes: '' },
          ],
        }),
      },
    })
    expect(w.text()).toContain('2 in initiative')
  })
})
