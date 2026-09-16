import { generateId } from '../ids'
import type { CampaignId, CharacterId } from '../ids/brand'
import { NotFoundError, ValidationError } from '../lib/errors'
import {
  type XpEntry,
  type XpEntryDraftInput,
  type XpEntryKind,
  totalXpFromLog,
  xpEntryDraftSchema,
} from '../models/xp-log'
import { EntityRepo } from '../persistence/entity-repo'
import { getStore, type KeyValueStore } from '../persistence/storage'
import { asTimestamp, now } from '../time/timestamps'

const STORAGE_KEY = 'xp-log:v1'

interface RepoEntry {
  id: string
  campaignId: CampaignId
  characterId: CharacterId
  kind: XpEntryKind
  amount: number
  reason: string
  recordedAt: ReturnType<typeof asTimestamp>
}

export class XpService {
  private readonly repo: EntityRepo<string, RepoEntry>

  constructor(store: KeyValueStore = getStore()) {
    this.repo = new EntityRepo<string, RepoEntry>(store, STORAGE_KEY)
  }

  listForCampaign(campaignId: CampaignId): XpEntry[] {
    return this.repo.list().filter((e) => e.campaignId === campaignId)
  }

  listForCharacter(characterId: CharacterId): XpEntry[] {
    return [...this.repo.list().filter((e) => e.characterId === characterId)].sort(
      (a, b) => a.recordedAt.localeCompare(b.recordedAt),
    )
  }

  totalFor(characterId: CharacterId): number {
    return totalXpFromLog(this.listForCharacter(characterId))
  }

  get(id: string): XpEntry {
    const found = this.repo.get(id)
    if (!found) throw new NotFoundError('XpEntry', id)
    return found
  }

  tryGet(id: string): XpEntry | null {
    return this.repo.get(id)
  }

  recordAward(draft: XpEntryDraftInput): XpEntry {
    return this.record(draft, 'award')
  }

  recordDeduct(draft: XpEntryDraftInput): XpEntry {
    return this.record(draft, 'deduct')
  }

  recordMilestone(draft: XpEntryDraftInput): XpEntry {
    return this.record(draft, 'milestone')
  }

  private record(draft: XpEntryDraftInput, kind: XpEntryKind): XpEntry {
    const parsed = xpEntryDraftSchema.safeParse({ ...draft, kind })
    if (!parsed.success) {
      throw new ValidationError(formatZodIssues(parsed.error.issues))
    }
    const entry: RepoEntry = {
      id: generateId('xp'),
      campaignId: parsed.data.campaignId as CampaignId,
      characterId: parsed.data.characterId as CharacterId,
      kind: parsed.data.kind ?? 'award',
      amount: parsed.data.amount,
      reason: (parsed.data.reason ?? '').trim(),
      recordedAt: now(),
    }
    this.repo.put(entry)
    return entry
  }

  delete(id: string): void {
    if (!this.repo.has(id)) throw new NotFoundError('XpEntry', id)
    this.repo.remove(id)
  }

  removeAllForCampaign(campaignId: CampaignId): number {
    const targets = this.listForCampaign(campaignId)
    for (const e of targets) this.repo.remove(e.id)
    return targets.length
  }

  removeAllForCharacter(characterId: CharacterId): number {
    const targets = this.listForCharacter(characterId)
    for (const e of targets) this.repo.remove(e.id)
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
