import { generateId } from '../ids'
import type { CampaignId } from '../ids/brand'
import { NotFoundError, ValidationError } from '../lib/errors'
import {
  type Holiday,
  type HolidayDraft,
  type HolidayKind,
  compareByDate,
  holidayDraftSchema,
} from '../models/holiday'
import { EntityRepo } from '../persistence/entity-repo'
import { getStore, type KeyValueStore } from '../persistence/storage'
import { now } from '../time/timestamps'

const STORAGE_KEY = 'holidays:v1'

export class HolidayService {
  private readonly repo: EntityRepo<string, Holiday>

  constructor(store: KeyValueStore = getStore()) {
    this.repo = new EntityRepo<string, Holiday>(store, STORAGE_KEY)
  }

  list(): Holiday[] {
    return this.repo.list()
  }

  listForCampaign(campaignId: CampaignId): Holiday[] {
    return this.repo
      .list()
      .filter((h) => h.campaignId === campaignId)
      .sort(compareByDate)
  }

  get(id: string): Holiday {
    const found = this.repo.get(id)
    if (!found) throw new NotFoundError('Holiday', id)
    return found
  }

  tryGet(id: string): Holiday | null {
    return this.repo.get(id)
  }

  create(draft: HolidayDraft): Holiday {
    const parsed = holidayDraftSchema.safeParse(draft)
    if (!parsed.success) throw new ValidationError(formatZodIssues(parsed.error.issues))
    const ts = now()
    const holiday: Holiday = {
      id: generateId('hol'),
      campaignId: parsed.data.campaignId as CampaignId,
      name: parsed.data.name.trim(),
      month: parsed.data.month,
      day: parsed.data.day,
      kind: (parsed.data.kind ?? 'civic') as HolidayKind,
      observance: (parsed.data.observance ?? '').trim(),
      createdAt: ts,
      updatedAt: ts,
    }
    return this.repo.put(holiday)
  }

  update(id: string, draft: HolidayDraft): Holiday {
    const existing = this.get(id)
    const parsed = holidayDraftSchema.safeParse(draft)
    if (!parsed.success) throw new ValidationError(formatZodIssues(parsed.error.issues))
    return this.repo.put({
      ...existing,
      campaignId: parsed.data.campaignId as CampaignId,
      name: parsed.data.name.trim(),
      month: parsed.data.month,
      day: parsed.data.day,
      kind: (parsed.data.kind ?? existing.kind) as HolidayKind,
      observance: (parsed.data.observance ?? existing.observance).trim(),
      updatedAt: now(),
    })
  }

  delete(id: string): void {
    if (!this.repo.has(id)) throw new NotFoundError('Holiday', id)
    this.repo.remove(id)
  }

  removeAllForCampaign(campaignId: CampaignId): number {
    const targets = this.listForCampaign(campaignId)
    for (const h of targets) this.repo.remove(h.id)
    return targets.length
  }

  /** Write a holiday that came out of a bundle. */
  restore(row: Holiday): Holiday {
    const parsed = holidayDraftSchema.safeParse(row)
    if (!parsed.success) throw new ValidationError(formatZodIssues(parsed.error.issues))
    const holiday: Holiday = {
      id: row.id,
      campaignId: parsed.data.campaignId as CampaignId,
      name: parsed.data.name.trim(),
      month: parsed.data.month,
      day: parsed.data.day,
      kind: (parsed.data.kind ?? 'civic') as HolidayKind,
      observance: (parsed.data.observance ?? '').trim(),
      createdAt: row.createdAt,
      updatedAt: now(),
    }
    return this.repo.put(holiday)
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
