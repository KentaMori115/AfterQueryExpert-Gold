import { z } from 'zod'

import type { CampaignId, LocationId } from '../ids'
import type { ISOTimestamp } from '../time/timestamps'

export type LocationKind =
  | 'plane'
  | 'continent'
  | 'region'
  | 'city'
  | 'town'
  | 'site'
  | 'dungeon'
  | 'lair'
  | 'wilds'
  | 'other'

export const LOCATION_KINDS: ReadonlyArray<LocationKind> = [
  'plane',
  'continent',
  'region',
  'city',
  'town',
  'site',
  'dungeon',
  'lair',
  'wilds',
  'other',
]

export interface Location {
  id: LocationId
  campaignId: CampaignId
  parentId: LocationId | null
  name: string
  kind: LocationKind
  shortDescription: string
  notes: string
  visited: boolean
  createdAt: ISOTimestamp
  updatedAt: ISOTimestamp
}

export interface LocationDraft {
  campaignId: CampaignId
  parentId?: LocationId | null
  name: string
  kind?: LocationKind
  shortDescription?: string
  notes?: string
  visited?: boolean
}

export const locationDraftSchema = z.object({
  campaignId: z.string().min(1),
  parentId: z.string().nullable().optional(),
  name: z.string().trim().min(1, 'name is required').max(120, 'name is too long'),
  kind: z
    .enum(['plane', 'continent', 'region', 'city', 'town', 'site', 'dungeon', 'lair', 'wilds', 'other'])
    .optional(),
  shortDescription: z.string().max(240, 'short description too long').optional(),
  notes: z.string().max(4096, 'notes too long').optional(),
  visited: z.boolean().optional(),
})

export type LocationDraftInput = z.input<typeof locationDraftSchema>

export function kindLabel(kind: LocationKind): string {
  switch (kind) {
    case 'plane':
      return 'Plane'
    case 'continent':
      return 'Continent'
    case 'region':
      return 'Region'
    case 'city':
      return 'City'
    case 'town':
      return 'Town'
    case 'site':
      return 'Site'
    case 'dungeon':
      return 'Dungeon'
    case 'lair':
      return 'Lair'
    case 'wilds':
      return 'Wilds'
    case 'other':
      return 'Other'
  }
}

export function kindIndent(kind: LocationKind): number {
  switch (kind) {
    case 'plane':
      return 0
    case 'continent':
      return 1
    case 'region':
      return 2
    case 'city':
    case 'town':
      return 3
    default:
      return 4
  }
}

export interface LocationNode {
  location: Location
  children: LocationNode[]
}

export function buildLocationTree(locations: ReadonlyArray<Location>): LocationNode[] {
  const nodes = new Map<string, LocationNode>()
  for (const l of locations) {
    nodes.set(l.id, { location: l, children: [] })
  }
  const roots: LocationNode[] = []
  for (const l of locations) {
    const node = nodes.get(l.id)!
    if (l.parentId && nodes.has(l.parentId)) {
      nodes.get(l.parentId)!.children.push(node)
    } else {
      roots.push(node)
    }
  }
  sortRecursive(roots)
  return roots
}

function sortRecursive(nodes: LocationNode[]): void {
  nodes.sort((a, b) => a.location.name.localeCompare(b.location.name))
  for (const n of nodes) sortRecursive(n.children)
}

export function flattenTree(nodes: ReadonlyArray<LocationNode>, depth = 0): Array<{ depth: number; location: Location }> {
  const out: Array<{ depth: number; location: Location }> = []
  for (const n of nodes) {
    out.push({ depth, location: n.location })
    out.push(...flattenTree(n.children, depth + 1))
  }
  return out
}

export function ancestorChain(
  start: Location | null,
  locations: ReadonlyArray<Location>,
): Location[] {
  if (!start) return []
  const byId = new Map(locations.map((l) => [l.id, l] as const))
  const chain: Location[] = []
  let cur: Location | null = start
  const seen = new Set<string>()
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id)
    chain.push(cur)
    cur = cur.parentId ? byId.get(cur.parentId) ?? null : null
  }
  return chain.reverse()
}

export function wouldCreateCycle(
  candidateParentId: LocationId | null,
  selfId: LocationId,
  locations: ReadonlyArray<Location>,
): boolean {
  if (!candidateParentId) return false
  if (candidateParentId === selfId) return true
  const byId = new Map(locations.map((l) => [l.id, l] as const))
  let cur = byId.get(candidateParentId) ?? null
  const seen = new Set<string>()
  while (cur && !seen.has(cur.id)) {
    if (cur.id === selfId) return true
    seen.add(cur.id)
    cur = cur.parentId ? byId.get(cur.parentId) ?? null : null
  }
  return false
}
