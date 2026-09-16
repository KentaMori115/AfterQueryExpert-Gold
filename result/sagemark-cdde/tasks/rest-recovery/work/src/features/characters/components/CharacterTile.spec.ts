import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import { asCampaignId, asCharacterId } from '@core/ids'
import type { Character } from '@core/models/character'
import { asTimestamp } from '@core/time/timestamps'

import CharacterTile from './CharacterTile.vue'

function build(over: Partial<Character> = {}): Character {
  return {
    id: asCharacterId('char_TEST'),
    campaignId: asCampaignId('camp_TEST'),
    kind: 'npc',
    name: 'Iris Thorne',
    pronouns: 'she/her',
    ancestry: 'human',
    vocation: 'warden',
    level: 7,
    disposition: 'allied',
    factionId: null,
    homeId: null,
    blurb: '',
    alive: true,
    createdAt: asTimestamp('2025-04-01T00:00:00Z'),
    updatedAt: asTimestamp('2025-04-01T00:00:00Z'),
    ...over,
  }
}

describe('CharacterTile', () => {
  it('renders name + initials + subtitle', () => {
    const w = mount(CharacterTile, { props: { character: build() } })
    expect(w.text()).toContain('Iris Thorne')
    expect(w.text()).toContain('IT')
    expect(w.text()).toContain('human')
    expect(w.text()).toContain('warden')
    expect(w.text()).toContain('lvl 7')
  })

  it('omits subtitle when no ancestry/vocation/level', () => {
    const w = mount(CharacterTile, {
      props: { character: build({ ancestry: '', vocation: '', level: 0 }) },
    })
    expect(w.findAll('p')).toHaveLength(0)
  })

  it('shows the PC marker for player characters', () => {
    const w = mount(CharacterTile, { props: { character: build({ kind: 'pc' }) } })
    expect(w.text()).toContain('PC')
  })

  it('shows the NPC marker for npcs', () => {
    const w = mount(CharacterTile, { props: { character: build({ kind: 'npc' }) } })
    expect(w.text()).toContain('NPC')
  })

  it('shows fallen tag and dims when not alive', () => {
    const w = mount(CharacterTile, { props: { character: build({ alive: false }) } })
    expect(w.text()).toContain('fallen')
    expect(w.classes().join(' ')).toContain('opacity-60')
  })

  it('does not dim when dimDead is explicitly false', () => {
    const w = mount(CharacterTile, {
      props: { character: build({ alive: false }), dimDead: false },
    })
    expect(w.classes().join(' ')).not.toContain('opacity-60')
  })

  it('renders the disposition badge', () => {
    const w = mount(CharacterTile, { props: { character: build({ disposition: 'hostile' }) } })
    expect(w.text()).toContain('Hostile')
  })
})
