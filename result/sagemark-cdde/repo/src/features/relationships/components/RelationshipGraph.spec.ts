import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import { asCampaignId, asCharacterId, asFactionId, asRelationshipId } from '@core/ids'
import type { Relationship } from '@core/models/relationship'
import { asTimestamp } from '@core/time/timestamps'

import RelationshipGraph from './RelationshipGraph.vue'

const camp = asCampaignId('camp_X')

function rel(over: Partial<Relationship> = {}): Relationship {
  return {
    id: asRelationshipId('rel_' + Math.random().toString(36).slice(2)),
    campaignId: camp,
    from: { kind: 'character', id: asCharacterId('A') },
    to: { kind: 'character', id: asCharacterId('B') },
    kind: 'ally',
    intensity: 3,
    note: '',
    reciprocal: true,
    createdAt: asTimestamp('2025-04-01'),
    updatedAt: asTimestamp('2025-04-01'),
    ...over,
  }
}

describe('RelationshipGraph', () => {
  it('shows empty message when there are no relationships', () => {
    const w = mount(RelationshipGraph, {
      props: { relationships: [], characters: [], factions: [] },
    })
    expect(w.text()).toContain('No relationships to draw')
  })

  it('renders a circle per unique node and a line per edge', () => {
    const r1 = rel({
      from: { kind: 'character', id: asCharacterId('A') },
      to: { kind: 'character', id: asCharacterId('B') },
    })
    const r2 = rel({
      from: { kind: 'character', id: asCharacterId('A') },
      to: { kind: 'faction', id: asFactionId('X') },
    })
    const w = mount(RelationshipGraph, {
      props: {
        relationships: [r1, r2],
        characters: [
          { id: asCharacterId('A'), name: 'Iris' },
          { id: asCharacterId('B'), name: 'Brann' },
        ],
        factions: [{ id: asFactionId('X'), name: 'Iron Hand' }],
      },
    })
    const circles = w.findAll('circle')
    expect(circles).toHaveLength(3)
    const lines = w.findAll('line')
    expect(lines).toHaveLength(2)
  })

  it('labels each node with the supplied name', () => {
    const w = mount(RelationshipGraph, {
      props: {
        relationships: [
          rel({
            from: { kind: 'character', id: asCharacterId('A') },
            to: { kind: 'character', id: asCharacterId('B') },
          }),
        ],
        characters: [
          { id: asCharacterId('A'), name: 'Iris' },
          { id: asCharacterId('B'), name: 'Brann' },
        ],
        factions: [],
      },
    })
    expect(w.text()).toContain('Iris')
    expect(w.text()).toContain('Brann')
  })

  it('uses a fatter stroke for higher intensity', () => {
    const w = mount(RelationshipGraph, {
      props: {
        relationships: [
          rel({
            from: { kind: 'character', id: asCharacterId('A') },
            to: { kind: 'character', id: asCharacterId('B') },
            intensity: 5,
          }),
        ],
        characters: [
          { id: asCharacterId('A'), name: 'Iris' },
          { id: asCharacterId('B'), name: 'Brann' },
        ],
        factions: [],
      },
    })
    const stroke = w.find('line').attributes('stroke-width')
    expect(Number(stroke)).toBeGreaterThan(1)
  })
})
