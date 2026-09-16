import { generateId } from '../ids'
import { asItemId, type CampaignId, type CharacterId, type ItemId } from '../ids/brand'
import { NotFoundError, ValidationError } from '../lib/errors'
import {
  type Item,
  type ItemDraftInput,
  itemDraftSchema,
} from '../models/item'
import { EntityRepo } from '../persistence/entity-repo'
import { getStore, type KeyValueStore } from '../persistence/storage'
import { now } from '../time/timestamps'

const STORAGE_KEY = 'items:v1'

export class ItemService {
  private readonly repo: EntityRepo<ItemId, Item>

  constructor(store: KeyValueStore = getStore()) {
    this.repo = new EntityRepo<ItemId, Item>(store, STORAGE_KEY)
  }

  list(): Item[] {
    return this.repo.list()
  }

  listForCampaign(campaignId: CampaignId): Item[] {
    return this.repo.list().filter((i) => i.campaignId === campaignId)
  }

  unownedFor(campaignId: CampaignId): Item[] {
    return this.listForCampaign(campaignId).filter((i) => i.ownerId === null)
  }

  ownedBy(ownerId: CharacterId): Item[] {
    return this.repo.list().filter((i) => i.ownerId === ownerId)
  }

  totalValueFor(campaignId: CampaignId): number {
    return this.listForCampaign(campaignId).reduce((sum, i) => sum + (i.valueGp || 0), 0)
  }

  get(id: ItemId): Item {
    const found = this.repo.get(id)
    if (!found) throw new NotFoundError('Item', id)
    return found
  }

  tryGet(id: ItemId): Item | null {
    return this.repo.get(id)
  }

  create(draft: ItemDraftInput): Item {
    const parsed = itemDraftSchema.safeParse(draft)
    if (!parsed.success) {
      throw new ValidationError(formatZodIssues(parsed.error.issues))
    }
    const ts = now()
    const item: Item = {
      id: asItemId(generateId('itm')),
      campaignId: parsed.data.campaignId as CampaignId,
      name: parsed.data.name,
      kind: parsed.data.kind ?? 'misc',
      rarity: parsed.data.rarity ?? 'common',
      magical: parsed.data.magical ?? false,
      attuned: parsed.data.attuned ?? false,
      ownerId: (parsed.data.ownerId ?? null) as CharacterId | null,
      description: parsed.data.description ?? '',
      valueGp: parsed.data.valueGp ?? 0,
      createdAt: ts,
      updatedAt: ts,
    }
    return this.repo.put(item)
  }

  update(id: ItemId, draft: ItemDraftInput): Item {
    const existing = this.get(id)
    const parsed = itemDraftSchema.safeParse(draft)
    if (!parsed.success) {
      throw new ValidationError(formatZodIssues(parsed.error.issues))
    }
    const next: Item = {
      ...existing,
      campaignId: parsed.data.campaignId as CampaignId,
      name: parsed.data.name,
      kind: parsed.data.kind ?? existing.kind,
      rarity: parsed.data.rarity ?? existing.rarity,
      magical: parsed.data.magical ?? existing.magical,
      attuned: parsed.data.attuned ?? existing.attuned,
      ownerId: (parsed.data.ownerId !== undefined
        ? parsed.data.ownerId
        : existing.ownerId) as CharacterId | null,
      description: parsed.data.description ?? existing.description,
      valueGp: parsed.data.valueGp ?? existing.valueGp,
      updatedAt: now(),
    }
    return this.repo.put(next)
  }

  giveTo(id: ItemId, ownerId: CharacterId | null): Item {
    const existing = this.get(id)
    if (existing.ownerId === ownerId) return existing
    // Unattune when changing hands
    return this.repo.put({
      ...existing,
      ownerId,
      attuned: false,
      updatedAt: now(),
    })
  }

  setAttuned(id: ItemId, attuned: boolean): Item {
    const existing = this.get(id)
    if (existing.attuned === attuned) return existing
    if (attuned && !existing.magical) {
      throw new ValidationError({ attuned: 'cannot attune to a non-magical item' })
    }
    if (attuned && existing.ownerId === null) {
      throw new ValidationError({ attuned: 'item has no owner to attune' })
    }
    return this.repo.put({ ...existing, attuned, updatedAt: now() })
  }

  delete(id: ItemId): void {
    if (!this.repo.has(id)) throw new NotFoundError('Item', id)
    this.repo.remove(id)
  }

  removeAllForCampaign(campaignId: CampaignId): number {
    const targets = this.listForCampaign(campaignId)
    for (const i of targets) this.repo.remove(i.id)
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
