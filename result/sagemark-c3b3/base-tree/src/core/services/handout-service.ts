import { generateId } from '../ids'
import type { CampaignId } from '../ids/brand'
import { NotFoundError, ValidationError } from '../lib/errors'
import {
  type Handout,
  type HandoutDraftInput,
  type HandoutVisibility,
  handoutDraftSchema,
} from '../models/handout'
import { EntityRepo } from '../persistence/entity-repo'
import { getStore, type KeyValueStore } from '../persistence/storage'
import { asTimestamp, now } from '../time/timestamps'

const STORAGE_KEY = 'handouts:v1'

export class HandoutService {
  private readonly repo: EntityRepo<string, Handout>

  constructor(store: KeyValueStore = getStore()) {
    this.repo = new EntityRepo<string, Handout>(store, STORAGE_KEY)
  }

  listForCampaign(campaignId: CampaignId): Handout[] {
    return this.repo.list().filter((h) => h.campaignId === campaignId)
  }

  byVisibility(campaignId: CampaignId, visibility: HandoutVisibility): Handout[] {
    return this.listForCampaign(campaignId).filter((h) => h.visibility === visibility)
  }

  forRecipient(campaignId: CampaignId, recipient: string): Handout[] {
    const lc = recipient.trim().toLowerCase()
    if (!lc) return []
    return this.listForCampaign(campaignId).filter((h) =>
      h.recipients.some((r) => r.toLowerCase() === lc),
    )
  }

  get(id: string): Handout {
    const found = this.repo.get(id)
    if (!found) throw new NotFoundError('Handout', id)
    return found
  }

  tryGet(id: string): Handout | null {
    return this.repo.get(id)
  }

  create(draft: HandoutDraftInput): Handout {
    const parsed = handoutDraftSchema.safeParse(draft)
    if (!parsed.success) {
      throw new ValidationError(formatZodIssues(parsed.error.issues))
    }
    const ts = now()
    const h: Handout = {
      id: generateId('hd'),
      campaignId: parsed.data.campaignId as CampaignId,
      title: parsed.data.title,
      body: parsed.data.body ?? '',
      kind: parsed.data.kind ?? 'note',
      visibility: parsed.data.visibility ?? 'draft',
      signature: (parsed.data.signature ?? '').trim(),
      recipients: cleanRecipients(parsed.data.recipients ?? []),
      createdAt: ts,
      updatedAt: ts,
      sharedAt: parsed.data.visibility === 'shared' ? ts : null,
    }
    return this.repo.put(h)
  }

  update(id: string, draft: HandoutDraftInput): Handout {
    const existing = this.get(id)
    const parsed = handoutDraftSchema.safeParse(draft)
    if (!parsed.success) {
      throw new ValidationError(formatZodIssues(parsed.error.issues))
    }
    const visibility = parsed.data.visibility ?? existing.visibility
    const sharedAt =
      visibility === 'shared'
        ? existing.sharedAt ?? now()
        : visibility === 'archived'
        ? existing.sharedAt
        : null
    const next: Handout = {
      ...existing,
      campaignId: parsed.data.campaignId as CampaignId,
      title: parsed.data.title,
      body: parsed.data.body ?? existing.body,
      kind: parsed.data.kind ?? existing.kind,
      visibility,
      signature: (parsed.data.signature ?? existing.signature).trim(),
      recipients: parsed.data.recipients
        ? cleanRecipients(parsed.data.recipients)
        : existing.recipients,
      sharedAt,
      updatedAt: now(),
    }
    return this.repo.put(next)
  }

  share(id: string, when: Date = new Date()): Handout {
    const existing = this.get(id)
    if (existing.visibility === 'shared') return existing
    return this.repo.put({
      ...existing,
      visibility: 'shared',
      sharedAt: asTimestamp(when),
      updatedAt: now(),
    })
  }

  unshare(id: string): Handout {
    const existing = this.get(id)
    if (existing.visibility !== 'shared') return existing
    return this.repo.put({
      ...existing,
      visibility: 'draft',
      sharedAt: null,
      updatedAt: now(),
    })
  }

  archive(id: string): Handout {
    const existing = this.get(id)
    if (existing.visibility === 'archived') return existing
    return this.repo.put({ ...existing, visibility: 'archived', updatedAt: now() })
  }

  addRecipient(id: string, name: string): Handout {
    const existing = this.get(id)
    const trimmed = name.trim()
    if (!trimmed) return existing
    if (existing.recipients.some((r) => r.toLowerCase() === trimmed.toLowerCase())) {
      return existing
    }
    return this.repo.put({
      ...existing,
      recipients: [...existing.recipients, trimmed],
      updatedAt: now(),
    })
  }

  removeRecipient(id: string, name: string): Handout {
    const existing = this.get(id)
    const next = existing.recipients.filter((r) => r.toLowerCase() !== name.toLowerCase())
    if (next.length === existing.recipients.length) return existing
    return this.repo.put({ ...existing, recipients: next, updatedAt: now() })
  }

  delete(id: string): void {
    if (!this.repo.has(id)) throw new NotFoundError('Handout', id)
    this.repo.remove(id)
  }

  removeAllForCampaign(campaignId: CampaignId): number {
    const targets = this.listForCampaign(campaignId)
    for (const h of targets) this.repo.remove(h.id)
    return targets.length
  }
}

function cleanRecipients(input: ReadonlyArray<string>): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of input) {
    const t = raw.trim()
    if (!t) continue
    const key = t.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(t)
  }
  return out
}

function formatZodIssues(issues: ReadonlyArray<{ path: (string | number)[]; message: string }>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const issue of issues) {
    const key = issue.path.join('.') || '_'
    if (!out[key]) out[key] = issue.message
  }
  return out
}
