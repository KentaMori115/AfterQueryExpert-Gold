import { generateId } from '../ids'
import type { CampaignId, FactionId } from '../ids/brand'
import { NotFoundError, ValidationError } from '../lib/errors'
import {
  type InfluenceSnapshot,
  type SnapshotDraftInput,
  snapshotDraftSchema,
} from '../models/influence-snapshot'
import { EntityRepo } from '../persistence/entity-repo'
import { getStore, type KeyValueStore } from '../persistence/storage'
import { now } from '../time/timestamps'

const STORAGE_KEY = 'influence-snapshots:v1'

export class InfluenceService {
  private readonly repo: EntityRepo<string, InfluenceSnapshot>

  constructor(store: KeyValueStore = getStore()) {
    this.repo = new EntityRepo<string, InfluenceSnapshot>(store, STORAGE_KEY)
  }

  listForCampaign(campaignId: CampaignId): InfluenceSnapshot[] {
    return this.repo.list().filter((s) => s.campaignId === campaignId)
  }

  listForFaction(factionId: FactionId): InfluenceSnapshot[] {
    return [...this.repo.list().filter((s) => s.factionId === factionId)].sort((a, b) =>
      a.recordedAt.localeCompare(b.recordedAt),
    )
  }

  get(id: string): InfluenceSnapshot {
    const found = this.repo.get(id)
    if (!found) throw new NotFoundError('InfluenceSnapshot', id)
    return found
  }

  tryGet(id: string): InfluenceSnapshot | null {
    return this.repo.get(id)
  }

  record(draft: SnapshotDraftInput): InfluenceSnapshot {
    const parsed = snapshotDraftSchema.safeParse(draft)
    if (!parsed.success) {
      throw new ValidationError(formatZodIssues(parsed.error.issues))
    }
    const entry: InfluenceSnapshot = {
      id: generateId('inf'),
      campaignId: parsed.data.campaignId as CampaignId,
      factionId: parsed.data.factionId as FactionId,
      influence: parsed.data.influence,
      recordedAt: now(),
      note: (parsed.data.note ?? '').trim(),
    }
    return this.repo.put(entry)
  }

  delete(id: string): void {
    if (!this.repo.has(id)) throw new NotFoundError('InfluenceSnapshot', id)
    this.repo.remove(id)
  }

  removeAllForCampaign(campaignId: CampaignId): number {
    const targets = this.listForCampaign(campaignId)
    for (const s of targets) this.repo.remove(s.id)
    return targets.length
  }

  removeAllForFaction(factionId: FactionId): number {
    const targets = this.listForFaction(factionId)
    for (const s of targets) this.repo.remove(s.id)
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
