import { generateId } from '../ids'
import {
  asTimelineEventId,
  type CampaignId,
  type TimelineEventId,
} from '../ids/brand'
import { NotFoundError, ValidationError } from '../lib/errors'
import {
  type InWorldDate,
  type TimelineDraftInput,
  type TimelineEvent,
  type TimelineSignificance,
  sortChronologically,
  timelineDraftSchema,
} from '../models/timeline'
import { EntityRepo } from '../persistence/entity-repo'
import { getStore, type KeyValueStore } from '../persistence/storage'
import { now } from '../time/timestamps'

const STORAGE_KEY = 'timeline:v1'

export class TimelineService {
  private readonly repo: EntityRepo<TimelineEventId, TimelineEvent>

  constructor(store: KeyValueStore = getStore()) {
    this.repo = new EntityRepo<TimelineEventId, TimelineEvent>(store, STORAGE_KEY)
  }

  list(): TimelineEvent[] {
    return this.repo.list()
  }

  listForCampaign(campaignId: CampaignId): TimelineEvent[] {
    return this.repo.list().filter((e) => e.campaignId === campaignId)
  }

  chronologicalFor(campaignId: CampaignId): TimelineEvent[] {
    return sortChronologically(this.listForCampaign(campaignId))
  }

  revealedFor(campaignId: CampaignId): TimelineEvent[] {
    return this.listForCampaign(campaignId).filter((e) => e.revealed)
  }

  get(id: TimelineEventId): TimelineEvent {
    const found = this.repo.get(id)
    if (!found) throw new NotFoundError('TimelineEvent', id)
    return found
  }

  tryGet(id: TimelineEventId): TimelineEvent | null {
    return this.repo.get(id)
  }

  create(draft: TimelineDraftInput): TimelineEvent {
    const parsed = timelineDraftSchema.safeParse(draft)
    if (!parsed.success) {
      throw new ValidationError(formatZodIssues(parsed.error.issues))
    }
    const ts = now()
    const event: TimelineEvent = {
      id: asTimelineEventId(generateId('tle')),
      campaignId: parsed.data.campaignId as CampaignId,
      title: parsed.data.title,
      description: parsed.data.description ?? '',
      date: parsed.data.date as InWorldDate,
      era: parsed.data.era ?? 'present',
      significance: (parsed.data.significance ?? 'notable') as TimelineSignificance,
      revealed: parsed.data.revealed ?? false,
      createdAt: ts,
      updatedAt: ts,
    }
    return this.repo.put(event)
  }

  update(id: TimelineEventId, draft: TimelineDraftInput): TimelineEvent {
    const existing = this.get(id)
    const parsed = timelineDraftSchema.safeParse(draft)
    if (!parsed.success) {
      throw new ValidationError(formatZodIssues(parsed.error.issues))
    }
    const next: TimelineEvent = {
      ...existing,
      campaignId: parsed.data.campaignId as CampaignId,
      title: parsed.data.title,
      description: parsed.data.description ?? existing.description,
      date: parsed.data.date as InWorldDate,
      era: parsed.data.era ?? existing.era,
      significance: (parsed.data.significance ?? existing.significance) as TimelineSignificance,
      revealed: parsed.data.revealed ?? existing.revealed,
      updatedAt: now(),
    }
    return this.repo.put(next)
  }

  setRevealed(id: TimelineEventId, revealed: boolean): TimelineEvent {
    const existing = this.get(id)
    if (existing.revealed === revealed) return existing
    return this.repo.put({ ...existing, revealed, updatedAt: now() })
  }

  delete(id: TimelineEventId): void {
    if (!this.repo.has(id)) throw new NotFoundError('TimelineEvent', id)
    this.repo.remove(id)
  }

  removeAllForCampaign(campaignId: CampaignId): number {
    const targets = this.listForCampaign(campaignId)
    for (const t of targets) this.repo.remove(t.id)
    return targets.length
  }

  /** Write a timeline event that came out of a bundle. */
  restore(row: TimelineEvent): TimelineEvent {
    const parsed = timelineDraftSchema.safeParse(row)
    if (!parsed.success) {
      throw new ValidationError(formatZodIssues(parsed.error.issues))
    }
    const event: TimelineEvent = {
      id: row.id,
      campaignId: parsed.data.campaignId as CampaignId,
      title: parsed.data.title,
      description: parsed.data.description ?? '',
      date: parsed.data.date as InWorldDate,
      era: parsed.data.era ?? 'present',
      significance: (parsed.data.significance ?? 'notable') as TimelineSignificance,
      revealed: parsed.data.revealed ?? false,
      createdAt: row.createdAt,
      updatedAt: now(),
    }
    return this.repo.put(event)
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
