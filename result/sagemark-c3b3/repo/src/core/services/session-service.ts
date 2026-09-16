import { generateId } from '../ids'
import {
  asSessionId,
  type CampaignId,
  type CharacterId,
  type LocationId,
  type SessionId,
} from '../ids/brand'
import { NotFoundError, ValidationError } from '../lib/errors'
import {
  type Session,
  type SessionDraftInput,
  nextNumber,
  sessionDraftSchema,
} from '../models/session'
import { EntityRepo } from '../persistence/entity-repo'
import { getStore, type KeyValueStore } from '../persistence/storage'
import { asTimestamp, now } from '../time/timestamps'

const STORAGE_KEY = 'sessions:v1'

export class SessionService {
  private readonly repo: EntityRepo<SessionId, Session>

  constructor(store: KeyValueStore = getStore()) {
    this.repo = new EntityRepo<SessionId, Session>(store, STORAGE_KEY)
  }

  list(): Session[] {
    return this.repo.list()
  }

  listForCampaign(campaignId: CampaignId): Session[] {
    return this.repo.list().filter((s) => s.campaignId === campaignId)
  }

  countForCampaign(campaignId: CampaignId): number {
    return this.listForCampaign(campaignId).length
  }

  latestForCampaign(campaignId: CampaignId, limit = 5): Session[] {
    const sorted = [...this.listForCampaign(campaignId)].sort((a, b) =>
      a.playedAt < b.playedAt ? 1 : a.playedAt > b.playedAt ? -1 : 0,
    )
    return sorted.slice(0, limit)
  }

  get(id: SessionId): Session {
    const found = this.repo.get(id)
    if (!found) throw new NotFoundError('Session', id)
    return found
  }

  tryGet(id: SessionId): Session | null {
    return this.repo.get(id)
  }

  create(draft: SessionDraftInput): Session {
    const parsed = sessionDraftSchema.safeParse(draft)
    if (!parsed.success) {
      throw new ValidationError(formatZodIssues(parsed.error.issues))
    }
    const ts = now()
    const number = nextNumber(this.listForCampaign(parsed.data.campaignId as CampaignId))
    const s: Session = {
      id: asSessionId(generateId('ses')),
      campaignId: parsed.data.campaignId as CampaignId,
      number,
      title: parsed.data.title,
      playedAt: asTimestamp(parsed.data.playedAt),
      durationMinutes: parsed.data.durationMinutes ?? 0,
      locationId: (parsed.data.locationId ?? null) as LocationId | null,
      attendees: (parsed.data.attendees ?? []) as ReadonlyArray<CharacterId>,
      summary: parsed.data.summary ?? '',
      log: parsed.data.log ?? '',
      createdAt: ts,
      updatedAt: ts,
    }
    return this.repo.put(s)
  }

  update(id: SessionId, draft: SessionDraftInput): Session {
    const existing = this.get(id)
    const parsed = sessionDraftSchema.safeParse(draft)
    if (!parsed.success) {
      throw new ValidationError(formatZodIssues(parsed.error.issues))
    }
    const next: Session = {
      ...existing,
      campaignId: parsed.data.campaignId as CampaignId,
      title: parsed.data.title,
      playedAt: asTimestamp(parsed.data.playedAt),
      durationMinutes: parsed.data.durationMinutes ?? existing.durationMinutes,
      locationId: (parsed.data.locationId !== undefined
        ? parsed.data.locationId
        : existing.locationId) as LocationId | null,
      attendees: (parsed.data.attendees ?? existing.attendees) as ReadonlyArray<CharacterId>,
      summary: parsed.data.summary ?? existing.summary,
      log: parsed.data.log ?? existing.log,
      updatedAt: now(),
    }
    return this.repo.put(next)
  }

  setAttendance(id: SessionId, characterId: CharacterId, present: boolean): Session {
    const existing = this.get(id)
    const set = new Set(existing.attendees)
    const before = set.has(characterId)
    if (present) set.add(characterId)
    else set.delete(characterId)
    const after = set.has(characterId)
    if (before === after) return existing
    return this.repo.put({
      ...existing,
      attendees: Array.from(set),
      updatedAt: now(),
    })
  }

  updateLog(id: SessionId, log: string): Session {
    const existing = this.get(id)
    if (existing.log === log) return existing
    return this.repo.put({ ...existing, log, updatedAt: now() })
  }

  delete(id: SessionId): void {
    if (!this.repo.has(id)) throw new NotFoundError('Session', id)
    this.repo.remove(id)
  }

  removeAllForCampaign(campaignId: CampaignId): number {
    const targets = this.listForCampaign(campaignId)
    for (const s of targets) this.repo.remove(s.id)
    return targets.length
  }

  /**
   * Write a session that came out of a bundle. The ordinal travels with the
   * row rather than being handed out again, so a restored campaign reads in
   * the order it was played.
   */
  restore(row: Session): Session {
    const parsed = sessionDraftSchema.safeParse(row)
    if (!parsed.success) {
      throw new ValidationError(formatZodIssues(parsed.error.issues))
    }
    const s: Session = {
      id: row.id,
      campaignId: parsed.data.campaignId as CampaignId,
      number: row.number,
      title: parsed.data.title,
      playedAt: asTimestamp(parsed.data.playedAt),
      durationMinutes: parsed.data.durationMinutes ?? 0,
      locationId: (parsed.data.locationId ?? null) as LocationId | null,
      attendees: (parsed.data.attendees ?? []) as ReadonlyArray<CharacterId>,
      summary: parsed.data.summary ?? '',
      log: parsed.data.log ?? '',
      createdAt: row.createdAt,
      updatedAt: now(),
    }
    return this.repo.put(s)
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
