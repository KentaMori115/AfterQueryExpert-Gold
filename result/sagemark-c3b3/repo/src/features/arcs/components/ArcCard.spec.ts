import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import { asArcId, asCampaignId } from '@core/ids'
import type { Arc } from '@core/models/arc'
import { asTimestamp } from '@core/time/timestamps'

import ArcCard from './ArcCard.vue'

function build(over: Partial<Arc> = {}): Arc {
  return {
    id: asArcId('arc_X'),
    campaignId: asCampaignId('camp_X'),
    title: 'The Long Winter',
    synopsis: 'A frost creeps southwards',
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

describe('ArcCard', () => {
  it('shows title + synopsis', () => {
    const w = mount(ArcCard, { props: { arc: build() } })
    expect(w.text()).toContain('The Long Winter')
    expect(w.text()).toContain('frost creeps')
  })

  it('shows status badge', () => {
    const w = mount(ArcCard, { props: { arc: build({ status: 'climbing' }) } })
    expect(w.text()).toContain('Climbing')
  })

  it('shows tension label and bar width', () => {
    const w = mount(ArcCard, { props: { arc: build({ tension: 'high' }) } })
    expect(w.text()).toContain('High')
    const bar = w.find('.bg-crimson-500')
    expect(bar.attributes('style')).toContain('width: 75%')
  })

  it('omits synopsis in compact mode', () => {
    const w = mount(ArcCard, { props: { arc: build(), compact: true } })
    expect(w.text()).not.toContain('frost creeps')
  })

  it('uses smaller text in compact mode', () => {
    const w = mount(ArcCard, { props: { arc: build(), compact: true } })
    expect(w.html()).toContain('text-sm')
  })
})
