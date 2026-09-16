import { generateId } from '../ids'
import { asCampaignId, type CampaignId } from '../ids/brand'
import { NotFoundError, ValidationError } from '../lib/errors'
import {
  type Campaign,
  type CampaignDraftInput,
  type CampaignStatus,
  campaignDraftSchema,
} from '../models/campaign'
import { EntityRepo } from '../persistence/entity-repo'
import { getStore, type KeyValueStore } from '../persistence/storage'
import { asTimestamp, now } from '../time/timestamps'

const STORAGE_KEY = 'campaigns:v1'

export class CampaignService {
  private readonly repo: EntityRepo<CampaignId, Campaign>

  constructor(store: KeyValueStore = getStore()) {
    this.repo = new EntityRepo<CampaignId, Campaign>(store, STORAGE_KEY)
  }

  list(): Campaign[] {
    return this.repo.list()
  }

  get(id: CampaignId): Campaign {
    const found = this.repo.get(id)
    if (!found) throw new NotFoundError('Campaign', id)
    return found
  }

  tryGet(id: CampaignId): Campaign | null {
    return this.repo.get(id)
  }

  create(draft: CampaignDraftInput): Campaign {
    const parsed = campaignDraftSchema.safeParse(draft)
    if (!parsed.success) {
      throw new ValidationError(formatZodIssues(parsed.error.issues))
    }
    const ts = now()
    const campaign: Campaign = {
      id: asCampaignId(generateId('camp')),
      name: parsed.data.name,
      tagline: parsed.data.tagline ?? '',
      system: parsed.data.system ?? 'custom',
      status: parsed.data.status ?? 'planning',
      startedAt: null,
      lastPlayedAt: null,
      sessionCount: 0,
      createdAt: ts,
      updatedAt: ts,
    }
    return this.repo.put(campaign)
  }

  update(id: CampaignId, draft: CampaignDraftInput): Campaign {
    const existing = this.get(id)
    const parsed = campaignDraftSchema.safeParse(draft)
    if (!parsed.success) {
      throw new ValidationError(formatZodIssues(parsed.error.issues))
    }
    const next: Campaign = {
      ...existing,
      name: parsed.data.name,
      tagline: parsed.data.tagline ?? existing.tagline,
      system: parsed.data.system ?? existing.system,
      status: parsed.data.status ?? existing.status,
      updatedAt: now(),
    }
    return this.repo.put(next)
  }

  setStatus(id: CampaignId, status: CampaignStatus): Campaign {
    const existing = this.get(id)
    const next: Campaign = {
      ...existing,
      status,
      updatedAt: now(),
    }
    return this.repo.put(next)
  }

  recordSessionPlayed(id: CampaignId, playedAt: string | Date = new Date()): Campaign {
    const existing = this.get(id)
    const ts = asTimestamp(playedAt)
    const next: Campaign = {
      ...existing,
      sessionCount: existing.sessionCount + 1,
      lastPlayedAt: ts,
      startedAt: existing.startedAt ?? ts,
      status: existing.status === 'planning' ? 'active' : existing.status,
      updatedAt: now(),
    }
    return this.repo.put(next)
  }

  delete(id: CampaignId): void {
    if (!this.repo.has(id)) throw new NotFoundError('Campaign', id)
    this.repo.remove(id)
  }

  count(): number {
    return this.repo.count()
  }

  /**
   * Write a campaign that came out of a bundle. Unlike create() this keeps the
   * id, the created stamp and the play counters it is handed; only the updated
   * stamp moves, because the row really is being written now.
   */
  restore(row: Campaign): Campaign {
    const parsed = campaignDraftSchema.safeParse(row)
    if (!parsed.success) {
      throw new ValidationError(formatZodIssues(parsed.error.issues))
    }
    const campaign: Campaign = {
      id: row.id,
      name: parsed.data.name,
      tagline: parsed.data.tagline ?? '',
      system: parsed.data.system ?? 'custom',
      status: parsed.data.status ?? 'planning',
      startedAt: row.startedAt,
      lastPlayedAt: row.lastPlayedAt,
      sessionCount: Math.max(0, Math.floor(row.sessionCount || 0)),
      createdAt: row.createdAt,
      updatedAt: now(),
    }
    return this.repo.put(campaign)
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
