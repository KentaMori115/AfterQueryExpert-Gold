import { generateId } from '../ids'
import { asNoteId, type CampaignId, type NoteId } from '../ids/brand'
import { NotFoundError, ValidationError } from '../lib/errors'
import {
  type Note,
  type NoteDraftInput,
  type NotePriority,
  type NoteTarget,
  noteDraftSchema,
} from '../models/note'
import { EntityRepo } from '../persistence/entity-repo'
import { getStore, type KeyValueStore } from '../persistence/storage'
import { asTimestamp, now } from '../time/timestamps'

const STORAGE_KEY = 'notes:v1'

export class NoteService {
  private readonly repo: EntityRepo<NoteId, Note>

  constructor(store: KeyValueStore = getStore()) {
    this.repo = new EntityRepo<NoteId, Note>(store, STORAGE_KEY)
  }

  list(): Note[] {
    return this.repo.list()
  }

  listForCampaign(campaignId: CampaignId): Note[] {
    return this.repo.list().filter((n) => n.campaignId === campaignId)
  }

  forTarget(campaignId: CampaignId, target: NoteTarget): Note[] {
    return this.listForCampaign(campaignId).filter(
      (n) => n.target.kind === target.kind && n.target.id === target.id,
    )
  }

  openFor(campaignId: CampaignId): Note[] {
    return this.listForCampaign(campaignId).filter((n) => n.resolvedAt === null)
  }

  pinnedFor(campaignId: CampaignId): Note[] {
    return this.listForCampaign(campaignId).filter((n) => n.pinned && n.resolvedAt === null)
  }

  overdueFor(campaignId: CampaignId, asOf: Date = new Date()): Note[] {
    return this.openFor(campaignId).filter(
      (n) => n.remindAt !== null && Date.parse(n.remindAt) < asOf.getTime(),
    )
  }

  get(id: NoteId): Note {
    const found = this.repo.get(id)
    if (!found) throw new NotFoundError('Note', id)
    return found
  }

  tryGet(id: NoteId): Note | null {
    return this.repo.get(id)
  }

  create(draft: NoteDraftInput): Note {
    const parsed = noteDraftSchema.safeParse(draft)
    if (!parsed.success) {
      throw new ValidationError(formatZodIssues(parsed.error.issues))
    }
    const ts = now()
    const remindAt = parsed.data.remindAt ? asTimestamp(parsed.data.remindAt) : null
    const note: Note = {
      id: asNoteId(generateId('not')),
      campaignId: parsed.data.campaignId as CampaignId,
      target: parsed.data.target as NoteTarget,
      title: parsed.data.title ?? '',
      body: parsed.data.body.trim(),
      priority: parsed.data.priority ?? 'normal',
      pinned: parsed.data.pinned ?? false,
      remindAt,
      resolvedAt: null,
      createdAt: ts,
      updatedAt: ts,
    }
    return this.repo.put(note)
  }

  update(id: NoteId, draft: NoteDraftInput): Note {
    const existing = this.get(id)
    const parsed = noteDraftSchema.safeParse(draft)
    if (!parsed.success) {
      throw new ValidationError(formatZodIssues(parsed.error.issues))
    }
    const remindAt =
      parsed.data.remindAt === undefined
        ? existing.remindAt
        : parsed.data.remindAt
        ? asTimestamp(parsed.data.remindAt)
        : null
    const next: Note = {
      ...existing,
      campaignId: parsed.data.campaignId as CampaignId,
      target: parsed.data.target as NoteTarget,
      title: parsed.data.title ?? existing.title,
      body: parsed.data.body.trim(),
      priority: parsed.data.priority ?? existing.priority,
      pinned: parsed.data.pinned ?? existing.pinned,
      remindAt,
      updatedAt: now(),
    }
    return this.repo.put(next)
  }

  setPriority(id: NoteId, priority: NotePriority): Note {
    const existing = this.get(id)
    if (existing.priority === priority) return existing
    return this.repo.put({ ...existing, priority, updatedAt: now() })
  }

  setPinned(id: NoteId, pinned: boolean): Note {
    const existing = this.get(id)
    if (existing.pinned === pinned) return existing
    return this.repo.put({ ...existing, pinned, updatedAt: now() })
  }

  resolve(id: NoteId, when: Date = new Date()): Note {
    const existing = this.get(id)
    if (existing.resolvedAt !== null) return existing
    return this.repo.put({ ...existing, resolvedAt: asTimestamp(when), updatedAt: now() })
  }

  reopen(id: NoteId): Note {
    const existing = this.get(id)
    if (existing.resolvedAt === null) return existing
    return this.repo.put({ ...existing, resolvedAt: null, updatedAt: now() })
  }

  delete(id: NoteId): void {
    if (!this.repo.has(id)) throw new NotFoundError('Note', id)
    this.repo.remove(id)
  }

  removeAllForCampaign(campaignId: CampaignId): number {
    const targets = this.listForCampaign(campaignId)
    for (const n of targets) this.repo.remove(n.id)
    return targets.length
  }

  removeAllForTarget(campaignId: CampaignId, target: NoteTarget): number {
    const targets = this.forTarget(campaignId, target)
    for (const n of targets) this.repo.remove(n.id)
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
