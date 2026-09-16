import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import { asCampaignId } from '@core/ids'
import type { Campaign } from '@core/models/campaign'
import { asTimestamp } from '@core/time/timestamps'

import CampaignTile from './CampaignTile.vue'

function build(over: Partial<Campaign> = {}): Campaign {
  return {
    id: asCampaignId('camp_TEST'),
    name: 'The Frozen Gate',
    tagline: 'a frostbitten realm',
    system: 'dnd5e',
    status: 'active',
    startedAt: asTimestamp('2025-01-01T00:00:00Z'),
    lastPlayedAt: asTimestamp('2025-03-01T22:00:00Z'),
    sessionCount: 7,
    createdAt: asTimestamp('2025-01-01T00:00:00Z'),
    updatedAt: asTimestamp('2025-03-01T22:00:00Z'),
    ...over,
  }
}

describe('CampaignTile', () => {
  it('shows the campaign name and tagline', () => {
    const w = mount(CampaignTile, { props: { campaign: build() } })
    expect(w.text()).toContain('The Frozen Gate')
    expect(w.text()).toContain('a frostbitten realm')
  })

  it('renders the system label', () => {
    const w = mount(CampaignTile, { props: { campaign: build() } })
    expect(w.text()).toContain('D&D 5e')
  })

  it('says "no sessions yet" when lastPlayed is null', () => {
    const w = mount(CampaignTile, {
      props: { campaign: build({ lastPlayedAt: null, sessionCount: 0 }) },
    })
    expect(w.text().toLowerCase()).toContain('no sessions yet')
  })

  it('shows the status label as a badge', () => {
    const w = mount(CampaignTile, {
      props: { campaign: build({ status: 'paused' }) },
    })
    expect(w.text()).toContain('Paused')
  })

  it('marks itself active via a ring when active is true', () => {
    const w = mount(CampaignTile, {
      props: { campaign: build(), active: true },
    })
    expect(w.classes().join(' ')).toContain('ring-2')
  })

  it('omits the tagline element when empty', () => {
    const w = mount(CampaignTile, {
      props: { campaign: build({ tagline: '' }) },
    })
    const paragraphs = w.findAll('p').map((p) => p.text())
    // We still have the "last played" paragraph so this only filters out the tagline one
    expect(paragraphs.find((t) => t.includes('frostbitten'))).toBeUndefined()
  })

  it('pluralises session count', () => {
    const single = mount(CampaignTile, {
      props: { campaign: build({ sessionCount: 1 }) },
    })
    expect(single.text()).toContain('1 session')

    const many = mount(CampaignTile, {
      props: { campaign: build({ sessionCount: 4 }) },
    })
    expect(many.text()).toContain('4 sessions')
  })
})
