import { generateId } from '../ids'
import { asCharacterId, type CampaignId, type CharacterId, type FactionId, type LocationId } from '../ids/brand'
import { NotFoundError, ValidationError } from '../lib/errors'
import {
  type Character,
  type CharacterDisposition,
  type CharacterDraftInput,
  characterDraftSchema,
} from '../models/character'
import { EntityRepo } from '../persistence/entity-repo'
import { getStore, type KeyValueStore } from '../persistence/storage'
import { now } from '../time/timestamps'

const STORAGE_KEY = 'characters:v1'

export class CharacterService {
  private readonly repo: EntityRepo<CharacterId, Character>

  constructor(store: KeyValueStore = getStore()) {
    this.repo = new EntityRepo<CharacterId, Character>(store, STORAGE_KEY)
  }

  list(): Character[] {
    return this.repo.list()
  }

  listForCampaign(campaignId: CampaignId): Character[] {
    return this.repo.list().filter((c) => c.campaignId === campaignId)
  }

  countForCampaign(campaignId: CampaignId): number {
    return this.listForCampaign(campaignId).length
  }

  get(id: CharacterId): Character {
    const found = this.repo.get(id)
    if (!found) throw new NotFoundError('Character', id)
    return found
  }

  tryGet(id: CharacterId): Character | null {
    return this.repo.get(id)
  }

  create(draft: CharacterDraftInput): Character {
    const parsed = characterDraftSchema.safeParse(draft)
    if (!parsed.success) {
      throw new ValidationError(formatZodIssues(parsed.error.issues))
    }
    const ts = now()
    const c: Character = {
      id: asCharacterId(generateId('char')),
      campaignId: parsed.data.campaignId as CampaignId,
      kind: parsed.data.kind ?? 'npc',
      name: parsed.data.name,
      pronouns: parsed.data.pronouns ?? '',
      ancestry: parsed.data.ancestry ?? '',
      vocation: parsed.data.vocation ?? '',
      level: parsed.data.level ?? 1,
      disposition: parsed.data.disposition ?? 'unknown',
      factionId: (parsed.data.factionId ?? null) as FactionId | null,
      homeId: (parsed.data.homeId ?? null) as LocationId | null,
      blurb: parsed.data.blurb ?? '',
      alive: parsed.data.alive ?? true,
      createdAt: ts,
      updatedAt: ts,
    }
    return this.repo.put(c)
  }

  update(id: CharacterId, draft: CharacterDraftInput): Character {
    const existing = this.get(id)
    const parsed = characterDraftSchema.safeParse(draft)
    if (!parsed.success) {
      throw new ValidationError(formatZodIssues(parsed.error.issues))
    }
    const next: Character = {
      ...existing,
      campaignId: parsed.data.campaignId as CampaignId,
      kind: parsed.data.kind ?? existing.kind,
      name: parsed.data.name,
      pronouns: parsed.data.pronouns ?? existing.pronouns,
      ancestry: parsed.data.ancestry ?? existing.ancestry,
      vocation: parsed.data.vocation ?? existing.vocation,
      level: parsed.data.level ?? existing.level,
      disposition: parsed.data.disposition ?? existing.disposition,
      factionId: (parsed.data.factionId !== undefined
        ? parsed.data.factionId
        : existing.factionId) as FactionId | null,
      homeId: (parsed.data.homeId !== undefined ? parsed.data.homeId : existing.homeId) as LocationId | null,
      blurb: parsed.data.blurb ?? existing.blurb,
      alive: parsed.data.alive ?? existing.alive,
      updatedAt: now(),
    }
    return this.repo.put(next)
  }

  setDisposition(id: CharacterId, disposition: CharacterDisposition): Character {
    const existing = this.get(id)
    return this.repo.put({ ...existing, disposition, updatedAt: now() })
  }

  markDeceased(id: CharacterId): Character {
    const existing = this.get(id)
    if (!existing.alive) return existing
    return this.repo.put({ ...existing, alive: false, updatedAt: now() })
  }

  revive(id: CharacterId): Character {
    const existing = this.get(id)
    if (existing.alive) return existing
    return this.repo.put({ ...existing, alive: true, updatedAt: now() })
  }

  delete(id: CharacterId): void {
    if (!this.repo.has(id)) throw new NotFoundError('Character', id)
    this.repo.remove(id)
  }

  removeAllForCampaign(campaignId: CampaignId): number {
    const targets = this.listForCampaign(campaignId)
    for (const c of targets) this.repo.remove(c.id)
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
