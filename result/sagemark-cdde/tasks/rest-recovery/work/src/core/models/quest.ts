import { z } from 'zod'

import type { ArcId, CampaignId, CharacterId, QuestId } from '../ids'
import type { ISOTimestamp } from '../time/timestamps'

export type QuestStatus = 'available' | 'accepted' | 'in-progress' | 'completed' | 'failed' | 'abandoned'

export const QUEST_STATUSES: ReadonlyArray<QuestStatus> = [
  'available',
  'accepted',
  'in-progress',
  'completed',
  'failed',
  'abandoned',
]

export type QuestPriority = 'low' | 'normal' | 'high' | 'urgent'

export const QUEST_PRIORITIES: ReadonlyArray<QuestPriority> = ['low', 'normal', 'high', 'urgent']

export interface QuestObjective {
  id: string
  text: string
  completed: boolean
}

export interface Quest {
  id: QuestId
  campaignId: CampaignId
  title: string
  description: string
  status: QuestStatus
  priority: QuestPriority
  giverId: CharacterId | null
  arcId: ArcId | null
  reward: string
  objectives: ReadonlyArray<QuestObjective>
  createdAt: ISOTimestamp
  updatedAt: ISOTimestamp
}

export interface QuestDraft {
  campaignId: CampaignId
  title: string
  description?: string
  status?: QuestStatus
  priority?: QuestPriority
  giverId?: CharacterId | null
  arcId?: ArcId | null
  reward?: string
  objectives?: ReadonlyArray<QuestObjective>
}

const objectiveSchema = z.object({
  id: z.string().min(1),
  text: z.string().trim().min(1, 'objective text required').max(240, 'objective too long'),
  completed: z.boolean(),
})

export const questDraftSchema = z.object({
  campaignId: z.string().min(1),
  title: z.string().trim().min(1, 'title is required').max(160, 'title too long'),
  description: z.string().max(2048, 'description too long').optional(),
  status: z.enum(['available', 'accepted', 'in-progress', 'completed', 'failed', 'abandoned']).optional(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
  giverId: z.string().nullable().optional(),
  arcId: z.string().nullable().optional(),
  reward: z.string().max(400, 'reward too long').optional(),
  objectives: z.array(objectiveSchema).max(20, 'too many objectives').optional(),
})

export type QuestDraftInput = z.input<typeof questDraftSchema>

export function statusLabel(s: QuestStatus): string {
  switch (s) {
    case 'available':
      return 'Available'
    case 'accepted':
      return 'Accepted'
    case 'in-progress':
      return 'In progress'
    case 'completed':
      return 'Completed'
    case 'failed':
      return 'Failed'
    case 'abandoned':
      return 'Abandoned'
  }
}

export function statusTone(s: QuestStatus): 'success' | 'warning' | 'danger' | 'info' | 'neutral' {
  switch (s) {
    case 'available':
      return 'info'
    case 'accepted':
    case 'in-progress':
      return 'warning'
    case 'completed':
      return 'success'
    case 'failed':
      return 'danger'
    case 'abandoned':
      return 'neutral'
  }
}

export function priorityLabel(p: QuestPriority): string {
  switch (p) {
    case 'low':
      return 'Low'
    case 'normal':
      return 'Normal'
    case 'high':
      return 'High'
    case 'urgent':
      return 'Urgent'
  }
}

export function isOpen(quest: Quest): boolean {
  return quest.status !== 'completed' && quest.status !== 'failed' && quest.status !== 'abandoned'
}

export function objectiveProgress(quest: Quest): { done: number; total: number; ratio: number } {
  const total = quest.objectives.length
  if (total === 0) return { done: 0, total: 0, ratio: 0 }
  const done = quest.objectives.filter((o) => o.completed).length
  return { done, total, ratio: done / total }
}

export function canTransition(from: QuestStatus, to: QuestStatus): boolean {
  if (from === to) return true
  const terminals: QuestStatus[] = ['completed', 'failed', 'abandoned']
  if (terminals.includes(from) && to !== from) {
    // Allow re-opening to in-progress
    return to === 'in-progress'
  }
  return true
}
