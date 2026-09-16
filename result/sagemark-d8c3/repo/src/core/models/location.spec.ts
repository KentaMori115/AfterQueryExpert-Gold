import { describe, expect, it } from 'vitest'

import { asCampaignId, asLocationId } from '../ids'
import { asTimestamp } from '../time/timestamps'

import {
  LOCATION_KINDS,
  ancestorChain,
  buildLocationTree,
  flattenTree,
  kindIndent,
  kindLabel,
  locationDraftSchema,
  wouldCreateCycle,
  type Location,
} from './location'

function loc(over: Partial<Location> & { id: string; name: string; parentId?: string | null }): Location {
  return {
    id: asLocationId(over.id),
    campaignId: asCampaignId('camp_TEST'),
    parentId: over.parentId === undefined ? null : (asLocationId(over.parentId as string) as never),
    name: over.name,
    kind: 'region',
    shortDescription: '',
    notes: '',
    visited: false,
    createdAt: asTimestamp('2025-01-01T00:00:00Z'),
    updatedAt: asTimestamp('2025-01-01T00:00:00Z'),
    ...over,
    id: asLocationId(over.id),
    parentId: over.parentId === undefined ? null : (asLocationId(over.parentId as string) as never),
  }
}

describe('constants and labels', () => {
  it('lists the kinds', () => {
    expect(LOCATION_KINDS).toContain('region')
    expect(LOCATION_KINDS).toContain('dungeon')
  })

  it('labels each kind', () => {
    for (const k of LOCATION_KINDS) {
      expect(kindLabel(k).length).toBeGreaterThan(0)
    }
  })

  it('indents larger places less deeply than smaller places', () => {
    expect(kindIndent('plane')).toBe(0)
    expect(kindIndent('city')).toBeGreaterThan(kindIndent('region'))
    expect(kindIndent('site')).toBeGreaterThan(kindIndent('town'))
  })
})

describe('buildLocationTree', () => {
  it('returns an empty list for no input', () => {
    expect(buildLocationTree([])).toEqual([])
  })

  it('places orphans at the root', () => {
    const a = loc({ id: 'a', name: 'A' })
    const b = loc({ id: 'b', name: 'B' })
    const tree = buildLocationTree([a, b])
    expect(tree).toHaveLength(2)
    expect(tree.map((n) => n.location.name).sort()).toEqual(['A', 'B'])
  })

  it('nests children under parents', () => {
    const root = loc({ id: 'r', name: 'Root' })
    const child = loc({ id: 'c', name: 'Child', parentId: 'r' })
    const grand = loc({ id: 'g', name: 'Grand', parentId: 'c' })
    const tree = buildLocationTree([root, child, grand])
    expect(tree).toHaveLength(1)
    expect(tree[0]!.children).toHaveLength(1)
    expect(tree[0]!.children[0]!.children).toHaveLength(1)
    expect(tree[0]!.children[0]!.children[0]!.location.name).toBe('Grand')
  })

  it('sorts siblings alphabetically at each level', () => {
    const r = loc({ id: 'r', name: 'Root' })
    const c1 = loc({ id: 'c1', name: 'Zeta', parentId: 'r' })
    const c2 = loc({ id: 'c2', name: 'Alpha', parentId: 'r' })
    const tree = buildLocationTree([r, c1, c2])
    expect(tree[0]!.children.map((c) => c.location.name)).toEqual(['Alpha', 'Zeta'])
  })

  it('treats unknown parent ids as orphans (root)', () => {
    const orphan = loc({ id: 'o', name: 'Orphan', parentId: 'nonexistent' })
    const tree = buildLocationTree([orphan])
    expect(tree).toHaveLength(1)
  })
})

describe('flattenTree', () => {
  it('returns depth-paired entries in DFS order', () => {
    const r = loc({ id: 'r', name: 'Root' })
    const a = loc({ id: 'a', name: 'A', parentId: 'r' })
    const b = loc({ id: 'b', name: 'B', parentId: 'a' })
    const tree = buildLocationTree([r, a, b])
    const flat = flattenTree(tree)
    expect(flat.map((f) => `${f.depth}:${f.location.name}`)).toEqual([
      '0:Root',
      '1:A',
      '2:B',
    ])
  })
})

describe('ancestorChain', () => {
  it('returns root-to-self for nested locations', () => {
    const r = loc({ id: 'r', name: 'Root' })
    const c = loc({ id: 'c', name: 'Child', parentId: 'r' })
    const g = loc({ id: 'g', name: 'Grand', parentId: 'c' })
    const chain = ancestorChain(g, [r, c, g])
    expect(chain.map((l) => l.name)).toEqual(['Root', 'Child', 'Grand'])
  })

  it('returns just self for a root', () => {
    const r = loc({ id: 'r', name: 'Root' })
    expect(ancestorChain(r, [r])).toHaveLength(1)
  })

  it('returns empty for null start', () => {
    expect(ancestorChain(null, [])).toEqual([])
  })

  it('stops at cycles instead of looping forever', () => {
    const a = loc({ id: 'a', name: 'A', parentId: 'b' })
    const b = loc({ id: 'b', name: 'B', parentId: 'a' })
    const chain = ancestorChain(a, [a, b])
    expect(chain.length).toBeLessThan(5)
  })
})

describe('wouldCreateCycle', () => {
  it('returns false for null candidate', () => {
    expect(wouldCreateCycle(null, asLocationId('x'), [])).toBe(false)
  })

  it('detects self-parent', () => {
    expect(wouldCreateCycle(asLocationId('x'), asLocationId('x'), [])).toBe(true)
  })

  it('detects descendant cycle', () => {
    const r = loc({ id: 'r', name: 'Root' })
    const c = loc({ id: 'c', name: 'Child', parentId: 'r' })
    // Trying to set Root's parent to Child would cycle
    expect(wouldCreateCycle(asLocationId('c'), asLocationId('r'), [r, c])).toBe(true)
  })

  it('passes legitimate reparents', () => {
    const a = loc({ id: 'a', name: 'A' })
    const b = loc({ id: 'b', name: 'B' })
    expect(wouldCreateCycle(asLocationId('a'), asLocationId('b'), [a, b])).toBe(false)
  })
})

describe('locationDraftSchema', () => {
  it('accepts a minimal valid draft', () => {
    expect(locationDraftSchema.safeParse({ campaignId: 'c', name: 'X' }).success).toBe(true)
  })

  it('rejects empty name', () => {
    expect(locationDraftSchema.safeParse({ campaignId: 'c', name: '  ' }).success).toBe(false)
  })

  it('rejects unknown kind', () => {
    expect(locationDraftSchema.safeParse({ campaignId: 'c', name: 'x', kind: 'galaxy' }).success).toBe(false)
  })

  it('allows null parentId', () => {
    expect(locationDraftSchema.safeParse({ campaignId: 'c', name: 'x', parentId: null }).success).toBe(true)
  })
})
