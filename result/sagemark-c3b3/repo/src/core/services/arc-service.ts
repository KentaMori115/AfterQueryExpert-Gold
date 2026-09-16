import { generateId } from '../ids'
import { asArcId, type ArcId, type CampaignId, type FactionId } from '../ids/brand'
import { NotFoundError, ValidationError } from '../lib/errors'
import {
  type Arc,
  type ArcDraftInput,
  type ArcStatus,
  type ArcTension,
  arcDraftSchema,
} from '../models/arc'
import { EntityRepo } from '../persistence/entity-repo'
import { getStore, type KeyValueStore } from '../persistence/storage'
import { now } from '../time/timestamps'

const STORAGE_KEY = 'arcs:v1'

export class ArcService {
  private readonly repo: EntityRepo<ArcId, Arc>

  constructor(store: KeyValueStore = getStore()) {
    this.repo = new EntityRepo<ArcId, Arc>(store, STORAGE_KEY)
  }

  list(): Arc[] {
    return this.repo.list()
  }

  listForCampaign(campaignId: CampaignId): Arc[] {
    return this.repo.list().filter((a) => a.campaignId === campaignId)
  }

  byStatus(campaignId: CampaignId, status: ArcStatus): Arc[] {
    return this.listForCampaign(campaignId).filter((a) => a.status === status)
  }

  liveCountFor(campaignId: CampaignId): number {
    return this.listForCampaign(campaignId).filter(
      (a) => a.status !== 'resolved' && a.status !== 'shelved',
    ).length
  }

  get(id: ArcId): Arc {
    const found = this.repo.get(id)
    if (!found) throw new NotFoundError('Arc', id)
    return found
  }

  tryGet(id: ArcId): Arc | null {
    return this.repo.get(id)
  }

  create(draft: ArcDraftInput): Arc {
    const parsed = arcDraftSchema.safeParse(draft)
    if (!parsed.success) {
      throw new ValidationError(formatZodIssues(parsed.error.issues))
    }
    const ts = now()
    const a: Arc = {
      id: asArcId(generateId('arc')),
      campaignId: parsed.data.campaignId as CampaignId,
      title: parsed.data.title,
      synopsis: parsed.data.synopsis ?? '',
      status: parsed.data.status ?? 'seeded',
      tension: parsed.data.tension ?? 'low',
      primaryFactionId: (parsed.data.primaryFactionId ?? null) as FactionId | null,
      rivalFactionId: (parsed.data.rivalFactionId ?? null) as FactionId | null,
      notes: parsed.data.notes ?? '',
      createdAt: ts,
      updatedAt: ts,
    }
    return this.repo.put(a)
  }

  update(id: ArcId, draft: ArcDraftInput): Arc {
    const existing = this.get(id)
    const parsed = arcDraftSchema.safeParse(draft)
    if (!parsed.success) {
      throw new ValidationError(formatZodIssues(parsed.error.issues))
    }
    const next: Arc = {
      ...existing,
      campaignId: parsed.data.campaignId as CampaignId,
      title: parsed.data.title,
      synopsis: parsed.data.synopsis ?? existing.synopsis,
      status: parsed.data.status ?? existing.status,
      tension: parsed.data.tension ?? existing.tension,
      primaryFactionId: (parsed.data.primaryFactionId !== undefined
        ? parsed.data.primaryFactionId
        : existing.primaryFactionId) as FactionId | null,
      rivalFactionId: (parsed.data.rivalFactionId !== undefined
        ? parsed.data.rivalFactionId
        : existing.rivalFactionId) as FactionId | null,
      notes: parsed.data.notes ?? existing.notes,
      updatedAt: now(),
    }
    return this.repo.put(next)
  }

  setStatus(id: ArcId, status: ArcStatus): Arc {
    const existing = this.get(id)
    if (existing.status === status) return existing
    return this.repo.put({ ...existing, status, updatedAt: now() })
  }

  setTension(id: ArcId, tension: ArcTension): Arc {
    const existing = this.get(id)
    if (existing.tension === tension) return existing
    return this.repo.put({ ...existing, tension, updatedAt: now() })
  }

  delete(id: ArcId): void {
    if (!this.repo.has(id)) throw new NotFoundError('Arc', id)
    this.repo.remove(id)
  }

  removeAllForCampaign(campaignId: CampaignId): number {
    const targets = this.listForCampaign(campaignId)
    for (const a of targets) this.repo.remove(a.id)
    return targets.length
  }

  /** Write an arc that came out of a bundle, id and created stamp kept. */
  restore(row: Arc): Arc {
    const parsed = arcDraftSchema.safeParse(row)
    if (!parsed.success) {
      throw new ValidationError(formatZodIssues(parsed.error.issues))
    }
    const a: Arc = {
      id: row.id,
      campaignId: parsed.data.campaignId as CampaignId,
      title: parsed.data.title,
      synopsis: parsed.data.synopsis ?? '',
      status: parsed.data.status ?? 'seeded',
      tension: parsed.data.tension ?? 'low',
      primaryFactionId: (parsed.data.primaryFactionId ?? null) as FactionId | null,
      rivalFactionId: (parsed.data.rivalFactionId ?? null) as FactionId | null,
      notes: parsed.data.notes ?? '',
      createdAt: row.createdAt,
      updatedAt: now(),
    }
    return this.repo.put(a)
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
