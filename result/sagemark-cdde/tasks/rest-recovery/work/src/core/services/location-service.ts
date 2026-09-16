import { generateId } from '../ids'
import { asLocationId, type CampaignId, type LocationId } from '../ids/brand'
import { ConflictError, NotFoundError, ValidationError } from '../lib/errors'
import {
  type Location,
  type LocationDraftInput,
  locationDraftSchema,
  wouldCreateCycle,
} from '../models/location'
import { EntityRepo } from '../persistence/entity-repo'
import { getStore, type KeyValueStore } from '../persistence/storage'
import { now } from '../time/timestamps'

const STORAGE_KEY = 'locations:v1'

export class LocationService {
  private readonly repo: EntityRepo<LocationId, Location>

  constructor(store: KeyValueStore = getStore()) {
    this.repo = new EntityRepo<LocationId, Location>(store, STORAGE_KEY)
  }

  list(): Location[] {
    return this.repo.list()
  }

  listForCampaign(campaignId: CampaignId): Location[] {
    return this.repo.list().filter((l) => l.campaignId === campaignId)
  }

  childrenOf(parentId: LocationId): Location[] {
    return this.repo.list().filter((l) => l.parentId === parentId)
  }

  get(id: LocationId): Location {
    const found = this.repo.get(id)
    if (!found) throw new NotFoundError('Location', id)
    return found
  }

  tryGet(id: LocationId): Location | null {
    return this.repo.get(id)
  }

  create(draft: LocationDraftInput): Location {
    const parsed = locationDraftSchema.safeParse(draft)
    if (!parsed.success) {
      throw new ValidationError(formatZodIssues(parsed.error.issues))
    }
    if (parsed.data.parentId) {
      const parent = this.repo.get(parsed.data.parentId as LocationId)
      if (!parent) {
        throw new ValidationError({ parentId: 'parent does not exist' })
      }
      if (parent.campaignId !== parsed.data.campaignId) {
        throw new ConflictError('parent belongs to a different campaign')
      }
    }
    const ts = now()
    const l: Location = {
      id: asLocationId(generateId('loc')),
      campaignId: parsed.data.campaignId as CampaignId,
      parentId: (parsed.data.parentId ?? null) as LocationId | null,
      name: parsed.data.name,
      kind: parsed.data.kind ?? 'region',
      shortDescription: parsed.data.shortDescription ?? '',
      notes: parsed.data.notes ?? '',
      visited: parsed.data.visited ?? false,
      createdAt: ts,
      updatedAt: ts,
    }
    return this.repo.put(l)
  }

  update(id: LocationId, draft: LocationDraftInput): Location {
    const existing = this.get(id)
    const parsed = locationDraftSchema.safeParse(draft)
    if (!parsed.success) {
      throw new ValidationError(formatZodIssues(parsed.error.issues))
    }
    const nextParentId = (parsed.data.parentId !== undefined
      ? parsed.data.parentId
      : existing.parentId) as LocationId | null

    if (nextParentId) {
      const parent = this.repo.get(nextParentId)
      if (!parent) {
        throw new ValidationError({ parentId: 'parent does not exist' })
      }
      if (parent.campaignId !== (parsed.data.campaignId as CampaignId)) {
        throw new ConflictError('parent belongs to a different campaign')
      }
      if (wouldCreateCycle(nextParentId, id, this.listForCampaign(existing.campaignId))) {
        throw new ConflictError('cannot make a location a descendant of itself')
      }
    }

    const next: Location = {
      ...existing,
      campaignId: parsed.data.campaignId as CampaignId,
      parentId: nextParentId,
      name: parsed.data.name,
      kind: parsed.data.kind ?? existing.kind,
      shortDescription: parsed.data.shortDescription ?? existing.shortDescription,
      notes: parsed.data.notes ?? existing.notes,
      visited: parsed.data.visited ?? existing.visited,
      updatedAt: now(),
    }
    return this.repo.put(next)
  }

  setVisited(id: LocationId, visited: boolean): Location {
    const existing = this.get(id)
    if (existing.visited === visited) return existing
    return this.repo.put({ ...existing, visited, updatedAt: now() })
  }

  setParent(id: LocationId, parentId: LocationId | null): Location {
    const existing = this.get(id)
    if (parentId) {
      const parent = this.repo.get(parentId)
      if (!parent) throw new ValidationError({ parentId: 'parent does not exist' })
      if (parent.campaignId !== existing.campaignId) {
        throw new ConflictError('parent belongs to a different campaign')
      }
      if (wouldCreateCycle(parentId, id, this.listForCampaign(existing.campaignId))) {
        throw new ConflictError('cannot make a location a descendant of itself')
      }
    }
    return this.repo.put({ ...existing, parentId, updatedAt: now() })
  }

  delete(id: LocationId, cascade = false): void {
    const existing = this.get(id)
    const children = this.childrenOf(id)
    if (children.length > 0 && !cascade) {
      throw new ConflictError(`${existing.name} has ${children.length} children; pass cascade to remove the whole subtree`)
    }
    if (cascade) {
      for (const child of children) {
        this.delete(child.id, true)
      }
    }
    this.repo.remove(id)
  }

  removeAllForCampaign(campaignId: CampaignId): number {
    const targets = this.listForCampaign(campaignId)
    for (const l of targets) this.repo.remove(l.id)
    return targets.length
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
