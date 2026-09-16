import { generateId } from '../ids'
import {
  asEncounterId,
  type CampaignId,
  type EncounterId,
  type LocationId,
  type SessionId,
} from '../ids/brand'
import { NotFoundError, ValidationError } from '../lib/errors'
import {
  type Encounter,
  type EncounterDraftInput,
  type InitiativeEntry,
  encounterDraftSchema,
} from '../models/encounter'
import { EntityRepo } from '../persistence/entity-repo'
import { getStore, type KeyValueStore } from '../persistence/storage'
import { now } from '../time/timestamps'

const STORAGE_KEY = 'encounters:v1'

export class EncounterService {
  private readonly repo: EntityRepo<EncounterId, Encounter>

  constructor(store: KeyValueStore = getStore()) {
    this.repo = new EntityRepo<EncounterId, Encounter>(store, STORAGE_KEY)
  }

  list(): Encounter[] {
    return this.repo.list()
  }

  listForCampaign(campaignId: CampaignId): Encounter[] {
    return this.repo.list().filter((e) => e.campaignId === campaignId)
  }

  unresolvedFor(campaignId: CampaignId): Encounter[] {
    return this.listForCampaign(campaignId).filter((e) => !e.resolved)
  }

  forSession(sessionId: SessionId): Encounter[] {
    return this.repo.list().filter((e) => e.sessionId === sessionId)
  }

  get(id: EncounterId): Encounter {
    const found = this.repo.get(id)
    if (!found) throw new NotFoundError('Encounter', id)
    return found
  }

  tryGet(id: EncounterId): Encounter | null {
    return this.repo.get(id)
  }

  create(draft: EncounterDraftInput): Encounter {
    const parsed = encounterDraftSchema.safeParse(draft)
    if (!parsed.success) {
      throw new ValidationError(formatZodIssues(parsed.error.issues))
    }
    const ts = now()
    const e: Encounter = {
      id: asEncounterId(generateId('enc')),
      campaignId: parsed.data.campaignId as CampaignId,
      sessionId: (parsed.data.sessionId ?? null) as SessionId | null,
      locationId: (parsed.data.locationId ?? null) as LocationId | null,
      title: parsed.data.title,
      kind: parsed.data.kind ?? 'combat',
      difficulty: parsed.data.difficulty ?? 'medium',
      summary: parsed.data.summary ?? '',
      initiative: (parsed.data.initiative ?? []) as ReadonlyArray<InitiativeEntry>,
      resolved: parsed.data.resolved ?? false,
      createdAt: ts,
      updatedAt: ts,
    }
    return this.repo.put(e)
  }

  update(id: EncounterId, draft: EncounterDraftInput): Encounter {
    const existing = this.get(id)
    const parsed = encounterDraftSchema.safeParse(draft)
    if (!parsed.success) {
      throw new ValidationError(formatZodIssues(parsed.error.issues))
    }
    const next: Encounter = {
      ...existing,
      campaignId: parsed.data.campaignId as CampaignId,
      sessionId: (parsed.data.sessionId !== undefined
        ? parsed.data.sessionId
        : existing.sessionId) as SessionId | null,
      locationId: (parsed.data.locationId !== undefined
        ? parsed.data.locationId
        : existing.locationId) as LocationId | null,
      title: parsed.data.title,
      kind: parsed.data.kind ?? existing.kind,
      difficulty: parsed.data.difficulty ?? existing.difficulty,
      summary: parsed.data.summary ?? existing.summary,
      initiative: (parsed.data.initiative ?? existing.initiative) as ReadonlyArray<InitiativeEntry>,
      resolved: parsed.data.resolved ?? existing.resolved,
      updatedAt: now(),
    }
    return this.repo.put(next)
  }

  setInitiative(id: EncounterId, initiative: ReadonlyArray<InitiativeEntry>): Encounter {
    const existing = this.get(id)
    return this.repo.put({ ...existing, initiative, updatedAt: now() })
  }

  markResolved(id: EncounterId, resolved = true): Encounter {
    const existing = this.get(id)
    if (existing.resolved === resolved) return existing
    return this.repo.put({ ...existing, resolved, updatedAt: now() })
  }

  delete(id: EncounterId): void {
    if (!this.repo.has(id)) throw new NotFoundError('Encounter', id)
    this.repo.remove(id)
  }

  removeAllForCampaign(campaignId: CampaignId): number {
    const targets = this.listForCampaign(campaignId)
    for (const e of targets) this.repo.remove(e.id)
    return targets.length
  }

  /** Write an encounter that came out of a bundle, initiative order included. */
  restore(row: Encounter): Encounter {
    const parsed = encounterDraftSchema.safeParse(row)
    if (!parsed.success) {
      throw new ValidationError(formatZodIssues(parsed.error.issues))
    }
    const e: Encounter = {
      id: row.id,
      campaignId: parsed.data.campaignId as CampaignId,
      sessionId: (parsed.data.sessionId ?? null) as SessionId | null,
      locationId: (parsed.data.locationId ?? null) as LocationId | null,
      title: parsed.data.title,
      kind: parsed.data.kind ?? 'combat',
      difficulty: parsed.data.difficulty ?? 'medium',
      summary: parsed.data.summary ?? '',
      initiative: (parsed.data.initiative ?? []) as ReadonlyArray<InitiativeEntry>,
      resolved: parsed.data.resolved ?? false,
      createdAt: row.createdAt,
      updatedAt: now(),
    }
    return this.repo.put(e)
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
