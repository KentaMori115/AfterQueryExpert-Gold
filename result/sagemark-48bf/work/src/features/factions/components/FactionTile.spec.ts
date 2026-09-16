import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import { asCampaignId, asFactionId } from '@core/ids'
import type { Faction } from '@core/models/faction'
import { asTimestamp } from '@core/time/timestamps'

import FactionTile from './FactionTile.vue'

function build(over: Partial<Faction> = {}): Faction {
  return {
    id: asFactionId('fac_TEST'),
    campaignId: asCampaignId('camp_TEST'),
    name: 'Crimson Order',
    motto: 'In silence, we hunt',
    description: '',
    alignment: 'neutral',
    scope: 'regional',
    influence: 60,
    leaderId: null,
    seatId: null,
    active: true,
    createdAt: asTimestamp('2025-01-01T00:00:00Z'),
    updatedAt: asTimestamp('2025-01-01T00:00:00Z'),
    ...over,
  }
}

describe('FactionTile', () => {
  it('shows name and motto', () => {
    const w = mount(FactionTile, { props: { faction: build() } })
    expect(w.text()).toContain('Crimson Order')
    expect(w.text()).toContain('In silence, we hunt')
  })

  it('omits motto block when empty', () => {
    const w = mount(FactionTile, { props: { faction: build({ motto: '' }) } })
    expect(w.text()).not.toContain('In silence, we hunt')
  })

  it('shows alignment badge', () => {
    const w = mount(FactionTile, { props: { faction: build({ alignment: 'evil' }) } })
    expect(w.text()).toContain('Evil')
  })

  it('shows scope', () => {
    const w = mount(FactionTile, { props: { faction: build({ scope: 'global' }) } })
    expect(w.text()).toContain('Global')
  })

  it('shows the influence tier phrase', () => {
    const w = mount(FactionTile, { props: { faction: build({ influence: 90 }) } })
    expect(w.text()).toBe(
      w.text().replace(/\s+/g, ' '),
    )
    expect(w.text()).toContain('Dominant')
  })

  it('renders the influence bar to scale', () => {
    const w = mount(FactionTile, { props: { faction: build({ influence: 42 }) } })
    const bar = w.find('.bg-ember-500')
    expect(bar.attributes('style')).toContain('width: 42%')
  })

  it('dims when faction is inactive', () => {
    const w = mount(FactionTile, { props: { faction: build({ active: false }) } })
    expect(w.classes().join(' ')).toContain('opacity-60')
  })
})
