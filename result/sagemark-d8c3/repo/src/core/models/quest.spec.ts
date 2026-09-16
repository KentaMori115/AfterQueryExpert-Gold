import { describe, expect, it } from 'vitest'

import { asCampaignId, asQuestId } from '../ids'
import { asTimestamp } from '../time/timestamps'

import {
  QUEST_PRIORITIES,
  QUEST_STATUSES,
  type Quest,
  canTransition,
  isOpen,
  objectiveProgress,
  priorityLabel,
  questDraftSchema,
  statusLabel,
  statusTone,
} from './quest'

function build(over: Partial<Quest> = {}): Quest {
  return {
    id: asQuestId('qst_X'),
    campaignId: asCampaignId('camp_X'),
    title: 'Find the missing scout',
    description: '',
    status: 'in-progress',
    priority: 'normal',
    giverId: null,
    arcId: null,
    reward: '',
    objectives: [],
    createdAt: asTimestamp('2025-04-01'),
    updatedAt: asTimestamp('2025-04-01'),
    ...over,
  }
}

describe('constants and labels', () => {
  it('lists statuses + priorities', () => {
    expect(QUEST_STATUSES).toContain('available')
    expect(QUEST_PRIORITIES).toContain('urgent')
  })

  it.each([
    ['available', 'info'],
    ['accepted', 'warning'],
    ['in-progress', 'warning'],
    ['completed', 'success'],
    ['failed', 'danger'],
    ['abandoned', 'neutral'],
  ] as const)('statusTone %s -> %s', (s, expected) => {
    expect(statusTone(s)).toBe(expected)
  })

  it.each([
    ['available', 'Available'],
    ['in-progress', 'In progress'],
  ] as const)('statusLabel %s -> %s', (s, expected) => {
    expect(statusLabel(s)).toBe(expected)
  })

  it('labels priorities', () => {
    expect(priorityLabel('urgent')).toBe('Urgent')
  })
})

describe('isOpen', () => {
  it('open for available/accepted/in-progress', () => {
    expect(isOpen(build({ status: 'available' }))).toBe(true)
    expect(isOpen(build({ status: 'accepted' }))).toBe(true)
    expect(isOpen(build({ status: 'in-progress' }))).toBe(true)
  })

  it('closed for completed/failed/abandoned', () => {
    expect(isOpen(build({ status: 'completed' }))).toBe(false)
    expect(isOpen(build({ status: 'failed' }))).toBe(false)
    expect(isOpen(build({ status: 'abandoned' }))).toBe(false)
  })
})

describe('objectiveProgress', () => {
  it('handles empty objectives', () => {
    expect(objectiveProgress(build())).toEqual({ done: 0, total: 0, ratio: 0 })
  })

  it('computes done/total/ratio', () => {
    const q = build({
      objectives: [
        { id: 'a', text: 'a', completed: true },
        { id: 'b', text: 'b', completed: false },
        { id: 'c', text: 'c', completed: true },
      ],
    })
    expect(objectiveProgress(q)).toEqual({ done: 2, total: 3, ratio: 2 / 3 })
  })
})

describe('canTransition', () => {
  it('allows same-state', () => {
    expect(canTransition('in-progress', 'in-progress')).toBe(true)
  })

  it('allows in-progress -> completed', () => {
    expect(canTransition('in-progress', 'completed')).toBe(true)
  })

  it('blocks completed -> failed', () => {
    expect(canTransition('completed', 'failed')).toBe(false)
  })

  it('allows reopening a terminal status to in-progress', () => {
    expect(canTransition('completed', 'in-progress')).toBe(true)
    expect(canTransition('failed', 'in-progress')).toBe(true)
    expect(canTransition('abandoned', 'in-progress')).toBe(true)
  })
})

describe('questDraftSchema', () => {
  it('accepts valid', () => {
    expect(questDraftSchema.safeParse({ campaignId: 'c', title: 'X' }).success).toBe(true)
  })

  it('rejects empty title', () => {
    expect(questDraftSchema.safeParse({ campaignId: 'c', title: '  ' }).success).toBe(false)
  })

  it('rejects bad objective', () => {
    expect(
      questDraftSchema.safeParse({
        campaignId: 'c',
        title: 'X',
        objectives: [{ id: 'a', text: '', completed: false }],
      }).success,
    ).toBe(false)
  })
})
