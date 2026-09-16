import { generateId } from '../ids'
import {
  asFactionId,
  type CampaignId,
  type CharacterId,
  type FactionId,
  type LocationId,
} from '../ids/brand'
import { NotFoundError, ValidationError } from '../lib/errors'
import {
  type Faction,
  type FactionDraftInput,
  factionDraftSchema,
} from '../models/faction'
import { EntityRepo } from '../persistence/entity-repo'
import { getStore, type KeyValueStore } from '../persistence/storage'
import { now } from '../time/timestamps'

const STORAGE_KEY = 'factions:v1'

export class FactionService {
  private readonly repo: EntityRepo<FactionId, Faction>

  constructor(store: KeyValueStore = getStore()) {
    this.repo = new EntityRepo<FactionId, Faction>(store, STORAGE_KEY)
  }

  list(): Faction[] {
    return this.repo.list()
  }

  listForCampaign(campaignId: CampaignId): Faction[] {
    return this.repo.list().filter((f) => f.campaignId === campaignId)
  }

  activeFor(campaignId: CampaignId): Faction[] {
    return this.listForCampaign(campaignId).filter((f) => f.active)
  }

  countForCampaign(campaignId: CampaignId): number {
    return this.listForCampaign(campaignId).length
  }

  get(id: FactionId): Faction {
    const found = this.repo.get(id)
    if (!found) throw new NotFoundError('Faction', id)
    return found
  }

  tryGet(id: FactionId): Faction | null {
    return this.repo.get(id)
  }

  create(draft: FactionDraftInput): Faction {
    const parsed = factionDraftSchema.safeParse(draft)
    if (!parsed.success) {
      throw new ValidationError(formatZodIssues(parsed.error.issues))
    }
    const ts = now()
    const f: Faction = {
      id: asFactionId(generateId('fac')),
      campaignId: parsed.data.campaignId as CampaignId,
      name: parsed.data.name,
      motto: parsed.data.motto ?? '',
      description: parsed.data.description ?? '',
      alignment: parsed.data.alignment ?? 'unknown',
      scope: parsed.data.scope ?? 'regional',
      influence: clamp(parsed.data.influence ?? 25, 0, 100),
      leaderId: (parsed.data.leaderId ?? null) as CharacterId | null,
      seatId: (parsed.data.seatId ?? null) as LocationId | null,
      active: parsed.data.active ?? true,
      createdAt: ts,
      updatedAt: ts,
    }
    return this.repo.put(f)
  }

  update(id: FactionId, draft: FactionDraftInput): Faction {
    const existing = this.get(id)
    const parsed = factionDraftSchema.safeParse(draft)
    if (!parsed.success) {
      throw new ValidationError(formatZodIssues(parsed.error.issues))
    }
    const next: Faction = {
      ...existing,
      campaignId: parsed.data.campaignId as CampaignId,
      name: parsed.data.name,
      motto: parsed.data.motto ?? existing.motto,
      description: parsed.data.description ?? existing.description,
      alignment: parsed.data.alignment ?? existing.alignment,
      scope: parsed.data.scope ?? existing.scope,
      influence: parsed.data.influence !== undefined ? clamp(parsed.data.influence, 0, 100) : existing.influence,
      leaderId: (parsed.data.leaderId !== undefined ? parsed.data.leaderId : existing.leaderId) as CharacterId | null,
      seatId: (parsed.data.seatId !== undefined ? parsed.data.seatId : existing.seatId) as LocationId | null,
      active: parsed.data.active ?? existing.active,
      updatedAt: now(),
    }
    return this.repo.put(next)
  }

  adjustInfluence(id: FactionId, delta: number): Faction {
    const existing = this.get(id)
    const next = clamp(existing.influence + delta, 0, 100)
    if (next === existing.influence) return existing
    return this.repo.put({ ...existing, influence: next, updatedAt: now() })
  }

  setActive(id: FactionId, active: boolean): Faction {
    const existing = this.get(id)
    if (existing.active === active) return existing
    return this.repo.put({ ...existing, active, updatedAt: now() })
  }

  setLeader(id: FactionId, leaderId: CharacterId | null): Faction {
    const existing = this.get(id)
    return this.repo.put({ ...existing, leaderId, updatedAt: now() })
  }

  delete(id: FactionId): void {
    if (!this.repo.has(id)) throw new NotFoundError('Faction', id)
    this.repo.remove(id)
  }

  removeAllForCampaign(campaignId: CampaignId): number {
    const targets = this.listForCampaign(campaignId)
    for (const f of targets) this.repo.remove(f.id)
    return targets.length
  }
}

function clamp(n: number, lo: number, hi: number): number {
  if (n < lo) return lo
  if (n > hi) return hi
  return n
}

function formatZodIssues(issues: ReadonlyArray<{ path: (string | number)[]; message: string }>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const issue of issues) {
    const key = issue.path.join('.') || '_'
    if (!out[key]) out[key] = issue.message
  }
  return out
}
