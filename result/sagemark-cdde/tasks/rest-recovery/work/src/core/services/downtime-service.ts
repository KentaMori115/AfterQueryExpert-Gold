import { generateId } from '../ids'
import type { CampaignId, CharacterId } from '../ids/brand'
import { NotFoundError, ValidationError } from '../lib/errors'
import {
  type DowntimeActivity,
  type DowntimeDraft,
  type DowntimeKind,
  type DowntimeOutcome,
  compareForListing,
  downtimeDraftSchema,
} from '../models/downtime'
import { EntityRepo } from '../persistence/entity-repo'
import { getStore, type KeyValueStore } from '../persistence/storage'
import { now } from '../time/timestamps'

const STORAGE_KEY = 'downtime:v1'

export class DowntimeService {
  private readonly repo: EntityRepo<string, DowntimeActivity>

  constructor(store: KeyValueStore = getStore()) {
    this.repo = new EntityRepo<string, DowntimeActivity>(store, STORAGE_KEY)
  }

  list(): DowntimeActivity[] {
    return this.repo.list()
  }

  listForCampaign(campaignId: CampaignId): DowntimeActivity[] {
    return this.repo
      .list()
      .filter((a) => a.campaignId === campaignId)
      .sort(compareForListing)
  }

  listForCharacter(campaignId: CampaignId, characterId: CharacterId): DowntimeActivity[] {
    return this.listForCampaign(campaignId).filter((a) => a.characterId === characterId)
  }

  get(id: string): DowntimeActivity {
    const found = this.repo.get(id)
    if (!found) throw new NotFoundError('DowntimeActivity', id)
    return found
  }

  tryGet(id: string): DowntimeActivity | null {
    return this.repo.get(id)
  }

  create(draft: DowntimeDraft): DowntimeActivity {
    const parsed = downtimeDraftSchema.safeParse(draft)
    if (!parsed.success) throw new ValidationError(formatZodIssues(parsed.error.issues))
    const ts = now()
    const activity: DowntimeActivity = {
      id: generateId('dt'),
      campaignId: parsed.data.campaignId as CampaignId,
      characterId: parsed.data.characterId as CharacterId,
      kind: parsed.data.kind as DowntimeKind,
      outcome: 'planned',
      weeks: parsed.data.weeks ?? 1,
      description: (parsed.data.description ?? '').trim(),
      reward: (parsed.data.reward ?? '').trim(),
      createdAt: ts,
      updatedAt: ts,
    }
    return this.repo.put(activity)
  }

  setOutcome(id: string, outcome: DowntimeOutcome): DowntimeActivity {
    const existing = this.get(id)
    if (existing.outcome === outcome) return existing
    return this.repo.put({ ...existing, outcome, updatedAt: now() })
  }

  setWeeks(id: string, weeks: number): DowntimeActivity {
    const existing = this.get(id)
    if (weeks < 0 || weeks > 520) {
      throw new ValidationError({ weeks: 'weeks must be between 0 and 520' })
    }
    if (existing.weeks === Math.floor(weeks)) return existing
    return this.repo.put({ ...existing, weeks: Math.floor(weeks), updatedAt: now() })
  }

  setDescription(id: string, description: string): DowntimeActivity {
    const existing = this.get(id)
    const trimmed = description.trim()
    if (trimmed.length > 280) {
      throw new ValidationError({ description: 'must be 280 characters or fewer' })
    }
    if (trimmed === existing.description) return existing
    return this.repo.put({ ...existing, description: trimmed, updatedAt: now() })
  }

  setReward(id: string, reward: string): DowntimeActivity {
    const existing = this.get(id)
    const trimmed = reward.trim()
    if (trimmed.length > 280) {
      throw new ValidationError({ reward: 'must be 280 characters or fewer' })
    }
    if (trimmed === existing.reward) return existing
    return this.repo.put({ ...existing, reward: trimmed, updatedAt: now() })
  }

  delete(id: string): void {
    if (!this.repo.has(id)) throw new NotFoundError('DowntimeActivity', id)
    this.repo.remove(id)
  }

  removeAllForCampaign(campaignId: CampaignId): number {
    const targets = this.listForCampaign(campaignId)
    for (const t of targets) this.repo.remove(t.id)
    return targets.length
  }

  removeAllForCharacter(campaignId: CampaignId, characterId: CharacterId): number {
    const targets = this.listForCharacter(campaignId, characterId)
    for (const t of targets) this.repo.remove(t.id)
    return targets.length
  }
}

function formatZodIssues(
  issues: ReadonlyArray<{ path: (string | number)[]; message: string }>,
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const issue of issues) {
    const key = issue.path.join('.') || '_'
    if (!out[key]) out[key] = issue.message
  }
  return out
}
