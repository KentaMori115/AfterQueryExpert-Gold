import { z } from 'zod'

import type {
  CampaignId,
  CharacterId,
  FactionId,
  RelationshipId,
} from '../ids'
import type { ISOTimestamp } from '../time/timestamps'

export type RelationshipKind =
  | 'ally'
  | 'rival'
  | 'mentor'
  | 'family'
  | 'romantic'
  | 'enemy'
  | 'employer'
  | 'subject'
  | 'unknown'

export const RELATIONSHIP_KINDS: ReadonlyArray<RelationshipKind> = [
  'ally',
  'rival',
  'mentor',
  'family',
  'romantic',
  'enemy',
  'employer',
  'subject',
  'unknown',
]

export type RelationshipEndpoint =
  | { kind: 'character'; id: CharacterId }
  | { kind: 'faction'; id: FactionId }

export interface Relationship {
  id: RelationshipId
  campaignId: CampaignId
  from: RelationshipEndpoint
  to: RelationshipEndpoint
  kind: RelationshipKind
  intensity: number // 1..5
  note: string
  reciprocal: boolean
  createdAt: ISOTimestamp
  updatedAt: ISOTimestamp
}

const endpointSchema = z.object({
  kind: z.enum(['character', 'faction']),
  id: z.string().min(1),
})

export const relationshipDraftSchema = z.object({
  campaignId: z.string().min(1),
  from: endpointSchema,
  to: endpointSchema,
  kind: z.enum([
    'ally',
    'rival',
    'mentor',
    'family',
    'romantic',
    'enemy',
    'employer',
    'subject',
    'unknown',
  ]).optional(),
  intensity: z.number().int().min(1, 'intensity is 1-5').max(5, 'intensity is 1-5').optional(),
  note: z.string().max(512, 'note too long').optional(),
  reciprocal: z.boolean().optional(),
}).refine(
  (data) => !(data.from.kind === data.to.kind && data.from.id === data.to.id),
  { message: 'cannot link a thing to itself', path: ['to'] },
)

export type RelationshipDraftInput = z.input<typeof relationshipDraftSchema>

export function kindLabel(k: RelationshipKind): string {
  switch (k) {
    case 'ally':
      return 'Ally'
    case 'rival':
      return 'Rival'
    case 'mentor':
      return 'Mentor'
    case 'family':
      return 'Family'
    case 'romantic':
      return 'Romantic'
    case 'enemy':
      return 'Enemy'
    case 'employer':
      return 'Employer'
    case 'subject':
      return 'Subject'
    case 'unknown':
      return 'Unknown'
  }
}

export function kindTone(k: RelationshipKind): 'success' | 'warning' | 'danger' | 'info' | 'neutral' {
  switch (k) {
    case 'ally':
    case 'family':
    case 'romantic':
      return 'success'
    case 'mentor':
    case 'employer':
    case 'subject':
      return 'info'
    case 'rival':
      return 'warning'
    case 'enemy':
      return 'danger'
    default:
      return 'neutral'
  }
}

export function endpointsMatch(a: RelationshipEndpoint, b: RelationshipEndpoint): boolean {
  return a.kind === b.kind && a.id === b.id
}

export function involvesNode(rel: Relationship, node: RelationshipEndpoint): boolean {
  return endpointsMatch(rel.from, node) || endpointsMatch(rel.to, node)
}

export function intensityWidth(intensity: number): number {
  const clamped = Math.max(1, Math.min(5, intensity))
  return clamped * 20
}
