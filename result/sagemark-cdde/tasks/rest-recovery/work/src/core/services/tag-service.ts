import { generateId } from '../ids'
import { asTagId, type CampaignId, type TagId } from '../ids/brand'
import { ConflictError, NotFoundError, ValidationError } from '../lib/errors'
import {
  type Tag,
  type TagDraft,
  type TagTargetKind,
  type TagTone,
  TAG_TONES,
  compareTagsForListing,
  isDuplicateSlug,
  slugifyTagName,
  tagDraftSchema,
} from '../models/tag'
import { EntityRepo } from '../persistence/entity-repo'
import { getStore, type KeyValueStore } from '../persistence/storage'
import { now } from '../time/timestamps'

const STORAGE_KEY = 'tags:v1'

export class TagService {
  private readonly repo: EntityRepo<TagId, Tag>

  constructor(store: KeyValueStore = getStore()) {
    this.repo = new EntityRepo<TagId, Tag>(store, STORAGE_KEY)
  }

  list(): Tag[] {
    return this.repo.list()
  }

  listForCampaign(campaignId: CampaignId): Tag[] {
    return this.repo
      .list()
      .filter((t) => t.campaignId === campaignId)
      .sort(compareTagsForListing)
  }

  get(id: TagId): Tag {
    const found = this.repo.get(id)
    if (!found) throw new NotFoundError('Tag', id)
    return found
  }

  tryGet(id: TagId): Tag | null {
    return this.repo.get(id)
  }

  forTarget(campaignId: CampaignId, kind: TagTargetKind, id: string): Tag[] {
    return this.listForCampaign(campaignId).filter((t) =>
      t.appliedTo.some((a) => a.kind === kind && a.id === id),
    )
  }

  create(draft: TagDraft): Tag {
    const parsed = tagDraftSchema.safeParse(draft)
    if (!parsed.success) throw new ValidationError(formatZodIssues(parsed.error.issues))
    const slug = slugifyTagName(parsed.data.name)
    const existing = this.listForCampaign(parsed.data.campaignId as CampaignId)
    if (isDuplicateSlug(slug, existing)) {
      throw new ConflictError(`tag "${slug}" already exists in this campaign`)
    }
    const ts = now()
    const tag: Tag = {
      id: asTagId(generateId('tag')),
      campaignId: parsed.data.campaignId as CampaignId,
      name: parsed.data.name.trim(),
      slug,
      tone: parsed.data.tone ?? pickDefaultTone(existing.length),
      description: (parsed.data.description ?? '').trim(),
      appliedTo: [],
      createdAt: ts,
      updatedAt: ts,
    }
    return this.repo.put(tag)
  }

  rename(id: TagId, name: string): Tag {
    const existing = this.get(id)
    const parsed = tagDraftSchema.safeParse({ campaignId: existing.campaignId, name })
    if (!parsed.success) throw new ValidationError(formatZodIssues(parsed.error.issues))
    const slug = slugifyTagName(parsed.data.name)
    if (slug !== existing.slug) {
      const peers = this.listForCampaign(existing.campaignId).filter((t) => t.id !== existing.id)
      if (isDuplicateSlug(slug, peers)) {
        throw new ConflictError(`tag "${slug}" already exists in this campaign`)
      }
    }
    return this.repo.put({
      ...existing,
      name: parsed.data.name.trim(),
      slug,
      updatedAt: now(),
    })
  }

  setTone(id: TagId, tone: TagTone): Tag {
    if (!TAG_TONES.includes(tone)) {
      throw new ValidationError({ tone: 'unknown tone' })
    }
    const existing = this.get(id)
    if (existing.tone === tone) return existing
    return this.repo.put({ ...existing, tone, updatedAt: now() })
  }

  setDescription(id: TagId, description: string): Tag {
    const existing = this.get(id)
    const trimmed = description.trim()
    if (trimmed.length > 280) {
      throw new ValidationError({ description: 'must be 280 characters or fewer' })
    }
    if (trimmed === existing.description) return existing
    return this.repo.put({ ...existing, description: trimmed, updatedAt: now() })
  }

  attach(id: TagId, kind: TagTargetKind, targetId: string): Tag {
    const existing = this.get(id)
    if (existing.appliedTo.some((a) => a.kind === kind && a.id === targetId)) return existing
    return this.repo.put({
      ...existing,
      appliedTo: [...existing.appliedTo, { kind, id: targetId }],
      updatedAt: now(),
    })
  }

  detach(id: TagId, kind: TagTargetKind, targetId: string): Tag {
    const existing = this.get(id)
    const next = existing.appliedTo.filter((a) => !(a.kind === kind && a.id === targetId))
    if (next.length === existing.appliedTo.length) return existing
    return this.repo.put({ ...existing, appliedTo: next, updatedAt: now() })
  }

  detachTarget(campaignId: CampaignId, kind: TagTargetKind, targetId: string): number {
    let removed = 0
    for (const t of this.listForCampaign(campaignId)) {
      if (t.appliedTo.some((a) => a.kind === kind && a.id === targetId)) {
        this.detach(t.id, kind, targetId)
        removed += 1
      }
    }
    return removed
  }

  delete(id: TagId): void {
    if (!this.repo.has(id)) throw new NotFoundError('Tag', id)
    this.repo.remove(id)
  }

  removeAllForCampaign(campaignId: CampaignId): number {
    const targets = this.listForCampaign(campaignId)
    for (const t of targets) this.repo.remove(t.id)
    return targets.length
  }
}

function pickDefaultTone(seed: number): TagTone {
  return TAG_TONES[seed % TAG_TONES.length] as TagTone
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
