import { generateId } from '../ids'
import {
  asRelationshipId,
  type CampaignId,
  type RelationshipId,
} from '../ids/brand'
import { NotFoundError, ValidationError } from '../lib/errors'
import {
  type Relationship,
  type RelationshipDraftInput,
  type RelationshipEndpoint,
  endpointsMatch,
  relationshipDraftSchema,
  involvesNode,
} from '../models/relationship'
import { EntityRepo } from '../persistence/entity-repo'
import { getStore, type KeyValueStore } from '../persistence/storage'
import { now } from '../time/timestamps'

const STORAGE_KEY = 'relationships:v1'

export class RelationshipService {
  private readonly repo: EntityRepo<RelationshipId, Relationship>

  constructor(store: KeyValueStore = getStore()) {
    this.repo = new EntityRepo<RelationshipId, Relationship>(store, STORAGE_KEY)
  }

  list(): Relationship[] {
    return this.repo.list()
  }

  listForCampaign(campaignId: CampaignId): Relationship[] {
    return this.repo.list().filter((r) => r.campaignId === campaignId)
  }

  forNode(campaignId: CampaignId, node: RelationshipEndpoint): Relationship[] {
    return this.listForCampaign(campaignId).filter((r) => involvesNode(r, node))
  }

  get(id: RelationshipId): Relationship {
    const found = this.repo.get(id)
    if (!found) throw new NotFoundError('Relationship', id)
    return found
  }

  tryGet(id: RelationshipId): Relationship | null {
    return this.repo.get(id)
  }

  create(draft: RelationshipDraftInput): Relationship {
    const parsed = relationshipDraftSchema.safeParse(draft)
    if (!parsed.success) {
      throw new ValidationError(formatZodIssues(parsed.error.issues))
    }
    const ts = now()
    const r: Relationship = {
      id: asRelationshipId(generateId('rel')),
      campaignId: parsed.data.campaignId as CampaignId,
      from: parsed.data.from as RelationshipEndpoint,
      to: parsed.data.to as RelationshipEndpoint,
      kind: parsed.data.kind ?? 'unknown',
      intensity: parsed.data.intensity ?? 3,
      note: parsed.data.note ?? '',
      reciprocal: parsed.data.reciprocal ?? true,
      createdAt: ts,
      updatedAt: ts,
    }
    return this.repo.put(r)
  }

  update(id: RelationshipId, draft: RelationshipDraftInput): Relationship {
    const existing = this.get(id)
    const parsed = relationshipDraftSchema.safeParse(draft)
    if (!parsed.success) {
      throw new ValidationError(formatZodIssues(parsed.error.issues))
    }
    const next: Relationship = {
      ...existing,
      campaignId: parsed.data.campaignId as CampaignId,
      from: parsed.data.from as RelationshipEndpoint,
      to: parsed.data.to as RelationshipEndpoint,
      kind: parsed.data.kind ?? existing.kind,
      intensity: parsed.data.intensity ?? existing.intensity,
      note: parsed.data.note ?? existing.note,
      reciprocal: parsed.data.reciprocal ?? existing.reciprocal,
      updatedAt: now(),
    }
    return this.repo.put(next)
  }

  delete(id: RelationshipId): void {
    if (!this.repo.has(id)) throw new NotFoundError('Relationship', id)
    this.repo.remove(id)
  }

  removeAllForCampaign(campaignId: CampaignId): number {
    const targets = this.listForCampaign(campaignId)
    for (const r of targets) this.repo.remove(r.id)
    return targets.length
  }

  removeAllInvolving(campaignId: CampaignId, node: RelationshipEndpoint): number {
    const targets = this.listForCampaign(campaignId).filter((r) => involvesNode(r, node))
    for (const r of targets) this.repo.remove(r.id)
    return targets.length
  }

  // Convenience for graph callers
  neighborsOf(campaignId: CampaignId, node: RelationshipEndpoint): RelationshipEndpoint[] {
    const out: RelationshipEndpoint[] = []
    for (const r of this.forNode(campaignId, node)) {
      const other = endpointsMatch(r.from, node) ? r.to : r.from
      if (!out.some((n) => endpointsMatch(n, other))) out.push(other)
    }
    return out
  }

  /** Write a relationship that came out of a bundle, both ends already resolved. */
  restore(row: Relationship): Relationship {
    const parsed = relationshipDraftSchema.safeParse(row)
    if (!parsed.success) {
      throw new ValidationError(formatZodIssues(parsed.error.issues))
    }
    const r: Relationship = {
      id: row.id,
      campaignId: parsed.data.campaignId as CampaignId,
      from: parsed.data.from as RelationshipEndpoint,
      to: parsed.data.to as RelationshipEndpoint,
      kind: parsed.data.kind ?? 'unknown',
      intensity: parsed.data.intensity ?? 3,
      note: parsed.data.note ?? '',
      reciprocal: parsed.data.reciprocal ?? true,
      createdAt: row.createdAt,
      updatedAt: now(),
    }
    return this.repo.put(r)
  }
}

function formatZodIssues(issues: ReadonlyArray<{ path: (string | number)[]; message: string }>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const issue of issues) {
    const key = issue.path.join('.') || '_'
    if (!out[key]) out[key] = issue.message
  }
  return out
}
