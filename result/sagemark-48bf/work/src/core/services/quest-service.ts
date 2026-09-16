import { generateId } from '../ids'
import {
  asQuestId,
  type ArcId,
  type CampaignId,
  type CharacterId,
  type QuestId,
} from '../ids/brand'
import { ConflictError, NotFoundError, ValidationError } from '../lib/errors'
import {
  type Quest,
  type QuestDraftInput,
  type QuestObjective,
  type QuestStatus,
  canTransition,
  questDraftSchema,
} from '../models/quest'
import { EntityRepo } from '../persistence/entity-repo'
import { getStore, type KeyValueStore } from '../persistence/storage'
import { now } from '../time/timestamps'

const STORAGE_KEY = 'quests:v1'

export class QuestService {
  private readonly repo: EntityRepo<QuestId, Quest>

  constructor(store: KeyValueStore = getStore()) {
    this.repo = new EntityRepo<QuestId, Quest>(store, STORAGE_KEY)
  }

  list(): Quest[] {
    return this.repo.list()
  }

  listForCampaign(campaignId: CampaignId): Quest[] {
    return this.repo.list().filter((q) => q.campaignId === campaignId)
  }

  openFor(campaignId: CampaignId): Quest[] {
    return this.listForCampaign(campaignId).filter(
      (q) => q.status !== 'completed' && q.status !== 'failed' && q.status !== 'abandoned',
    )
  }

  get(id: QuestId): Quest {
    const found = this.repo.get(id)
    if (!found) throw new NotFoundError('Quest', id)
    return found
  }

  tryGet(id: QuestId): Quest | null {
    return this.repo.get(id)
  }

  create(draft: QuestDraftInput): Quest {
    const parsed = questDraftSchema.safeParse(draft)
    if (!parsed.success) {
      throw new ValidationError(formatZodIssues(parsed.error.issues))
    }
    const ts = now()
    const q: Quest = {
      id: asQuestId(generateId('qst')),
      campaignId: parsed.data.campaignId as CampaignId,
      title: parsed.data.title,
      description: parsed.data.description ?? '',
      status: parsed.data.status ?? 'available',
      priority: parsed.data.priority ?? 'normal',
      giverId: (parsed.data.giverId ?? null) as CharacterId | null,
      arcId: (parsed.data.arcId ?? null) as ArcId | null,
      reward: parsed.data.reward ?? '',
      objectives: (parsed.data.objectives ?? []) as ReadonlyArray<QuestObjective>,
      createdAt: ts,
      updatedAt: ts,
    }
    return this.repo.put(q)
  }

  update(id: QuestId, draft: QuestDraftInput): Quest {
    const existing = this.get(id)
    const parsed = questDraftSchema.safeParse(draft)
    if (!parsed.success) {
      throw new ValidationError(formatZodIssues(parsed.error.issues))
    }
    const next: Quest = {
      ...existing,
      campaignId: parsed.data.campaignId as CampaignId,
      title: parsed.data.title,
      description: parsed.data.description ?? existing.description,
      status: parsed.data.status ?? existing.status,
      priority: parsed.data.priority ?? existing.priority,
      giverId: (parsed.data.giverId !== undefined
        ? parsed.data.giverId
        : existing.giverId) as CharacterId | null,
      arcId: (parsed.data.arcId !== undefined ? parsed.data.arcId : existing.arcId) as ArcId | null,
      reward: parsed.data.reward ?? existing.reward,
      objectives: (parsed.data.objectives ?? existing.objectives) as ReadonlyArray<QuestObjective>,
      updatedAt: now(),
    }
    return this.repo.put(next)
  }

  setStatus(id: QuestId, status: QuestStatus): Quest {
    const existing = this.get(id)
    if (existing.status === status) return existing
    if (!canTransition(existing.status, status)) {
      throw new ConflictError(`cannot transition from ${existing.status} to ${status}`)
    }
    return this.repo.put({ ...existing, status, updatedAt: now() })
  }

  addObjective(id: QuestId, text: string): Quest {
    const existing = this.get(id)
    const trimmed = text.trim()
    if (!trimmed) throw new ValidationError({ text: 'objective text is required' })
    const obj: QuestObjective = {
      id: generateId('obj').toLowerCase(),
      text: trimmed,
      completed: false,
    }
    return this.repo.put({
      ...existing,
      objectives: [...existing.objectives, obj],
      updatedAt: now(),
    })
  }

  toggleObjective(id: QuestId, objectiveId: string): Quest {
    const existing = this.get(id)
    const objectives = existing.objectives.map((o) =>
      o.id === objectiveId ? { ...o, completed: !o.completed } : o,
    )
    return this.repo.put({ ...existing, objectives, updatedAt: now() })
  }

  removeObjective(id: QuestId, objectiveId: string): Quest {
    const existing = this.get(id)
    const objectives = existing.objectives.filter((o) => o.id !== objectiveId)
    return this.repo.put({ ...existing, objectives, updatedAt: now() })
  }

  delete(id: QuestId): void {
    if (!this.repo.has(id)) throw new NotFoundError('Quest', id)
    this.repo.remove(id)
  }

  removeAllForCampaign(campaignId: CampaignId): number {
    const targets = this.listForCampaign(campaignId)
    for (const q of targets) this.repo.remove(q.id)
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
