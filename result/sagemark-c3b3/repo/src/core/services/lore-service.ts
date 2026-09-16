import { generateId } from '../ids'
import { asLoreId, type CampaignId, type LoreId } from '../ids/brand'
import { NotFoundError, ValidationError } from '../lib/errors'
import {
  type LoreEntry,
  type LoreDraftInput,
  loreDraftSchema,
  normaliseTags,
  matchesTag,
  freeTextMatches,
} from '../models/lore'
import { EntityRepo } from '../persistence/entity-repo'
import { getStore, type KeyValueStore } from '../persistence/storage'
import { now } from '../time/timestamps'

const STORAGE_KEY = 'lore:v1'

export class LoreService {
  private readonly repo: EntityRepo<LoreId, LoreEntry>

  constructor(store: KeyValueStore = getStore()) {
    this.repo = new EntityRepo<LoreId, LoreEntry>(store, STORAGE_KEY)
  }

  list(): LoreEntry[] {
    return this.repo.list()
  }

  listForCampaign(campaignId: CampaignId): LoreEntry[] {
    return this.repo.list().filter((l) => l.campaignId === campaignId)
  }

  revealedFor(campaignId: CampaignId): LoreEntry[] {
    return this.listForCampaign(campaignId).filter((l) => l.revealed)
  }

  taggedFor(campaignId: CampaignId, tag: string): LoreEntry[] {
    return this.listForCampaign(campaignId).filter((l) => matchesTag(l, tag))
  }

  searchFor(campaignId: CampaignId, query: string): LoreEntry[] {
    return this.listForCampaign(campaignId).filter((l) => freeTextMatches(l, query))
  }

  uniqueTagsFor(campaignId: CampaignId): string[] {
    const all = new Set<string>()
    for (const entry of this.listForCampaign(campaignId)) {
      for (const t of entry.tags) all.add(t)
    }
    return [...all].sort()
  }

  get(id: LoreId): LoreEntry {
    const found = this.repo.get(id)
    if (!found) throw new NotFoundError('Lore', id)
    return found
  }

  tryGet(id: LoreId): LoreEntry | null {
    return this.repo.get(id)
  }

  create(draft: LoreDraftInput): LoreEntry {
    const parsed = loreDraftSchema.safeParse(draft)
    if (!parsed.success) {
      throw new ValidationError(formatZodIssues(parsed.error.issues))
    }
    const ts = now()
    const entry: LoreEntry = {
      id: asLoreId(generateId('lor')),
      campaignId: parsed.data.campaignId as CampaignId,
      title: parsed.data.title,
      body: parsed.data.body ?? '',
      category: parsed.data.category ?? 'misc',
      tags: normaliseTags(parsed.data.tags ?? []),
      revealed: parsed.data.revealed ?? false,
      pinned: parsed.data.pinned ?? false,
      createdAt: ts,
      updatedAt: ts,
    }
    return this.repo.put(entry)
  }

  update(id: LoreId, draft: LoreDraftInput): LoreEntry {
    const existing = this.get(id)
    const parsed = loreDraftSchema.safeParse(draft)
    if (!parsed.success) {
      throw new ValidationError(formatZodIssues(parsed.error.issues))
    }
    const next: LoreEntry = {
      ...existing,
      campaignId: parsed.data.campaignId as CampaignId,
      title: parsed.data.title,
      body: parsed.data.body ?? existing.body,
      category: parsed.data.category ?? existing.category,
      tags: parsed.data.tags ? normaliseTags(parsed.data.tags) : existing.tags,
      revealed: parsed.data.revealed ?? existing.revealed,
      pinned: parsed.data.pinned ?? existing.pinned,
      updatedAt: now(),
    }
    return this.repo.put(next)
  }

  setRevealed(id: LoreId, revealed: boolean): LoreEntry {
    const existing = this.get(id)
    if (existing.revealed === revealed) return existing
    return this.repo.put({ ...existing, revealed, updatedAt: now() })
  }

  setPinned(id: LoreId, pinned: boolean): LoreEntry {
    const existing = this.get(id)
    if (existing.pinned === pinned) return existing
    return this.repo.put({ ...existing, pinned, updatedAt: now() })
  }

  delete(id: LoreId): void {
    if (!this.repo.has(id)) throw new NotFoundError('Lore', id)
    this.repo.remove(id)
  }

  removeAllForCampaign(campaignId: CampaignId): number {
    const targets = this.listForCampaign(campaignId)
    for (const e of targets) this.repo.remove(e.id)
    return targets.length
  }

  /** Write a lore entry that came out of a bundle, id and created stamp kept. */
  restore(row: LoreEntry): LoreEntry {
    const parsed = loreDraftSchema.safeParse(row)
    if (!parsed.success) {
      throw new ValidationError(formatZodIssues(parsed.error.issues))
    }
    const entry: LoreEntry = {
      id: row.id,
      campaignId: parsed.data.campaignId as CampaignId,
      title: parsed.data.title,
      body: parsed.data.body ?? '',
      category: parsed.data.category ?? 'misc',
      tags: normaliseTags(parsed.data.tags ?? []),
      revealed: parsed.data.revealed ?? false,
      pinned: parsed.data.pinned ?? false,
      createdAt: row.createdAt,
      updatedAt: now(),
    }
    return this.repo.put(entry)
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
