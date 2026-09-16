import { beforeEach, describe, expect, it } from 'vitest'

import { asCampaignId } from '../ids'
import { ConflictError, NotFoundError, ValidationError } from '../lib/errors'
import { MemoryStore } from '../persistence/storage'

import { QuestService } from './quest-service'

describe('QuestService', () => {
  const camp = asCampaignId('camp_TEST123456')
  const other = asCampaignId('camp_OTHER12345')

  let store: MemoryStore
  let svc: QuestService

  beforeEach(() => {
    store = new MemoryStore()
    svc = new QuestService(store)
  })

  describe('create', () => {
    it('builds with defaults', () => {
      const q = svc.create({ campaignId: camp, title: 'Find the cat' })
      expect(q.status).toBe('available')
      expect(q.priority).toBe('normal')
      expect(q.objectives).toEqual([])
    })

    it('rejects empty title', () => {
      expect(() => svc.create({ campaignId: camp, title: '   ' })).toThrow(ValidationError)
    })
  })

  describe('list helpers', () => {
    it('openFor filters terminal statuses', () => {
      svc.create({ campaignId: camp, title: 'a' })
      svc.create({ campaignId: camp, title: 'b', status: 'completed' })
      svc.create({ campaignId: camp, title: 'c', status: 'in-progress' })
      expect(svc.openFor(camp)).toHaveLength(2)
    })
  })

  describe('setStatus', () => {
    it('moves to a new status', () => {
      const q = svc.create({ campaignId: camp, title: 'X' })
      const moved = svc.setStatus(q.id, 'accepted')
      expect(moved.status).toBe('accepted')
    })

    it('no-ops same status', () => {
      const q = svc.create({ campaignId: camp, title: 'X' })
      const again = svc.setStatus(q.id, 'available')
      expect(again.updatedAt).toBe(q.updatedAt)
    })

    it('blocks invalid transition completed -> failed', () => {
      const q = svc.create({ campaignId: camp, title: 'X', status: 'completed' })
      expect(() => svc.setStatus(q.id, 'failed')).toThrow(ConflictError)
    })

    it('allows reopening completed -> in-progress', () => {
      const q = svc.create({ campaignId: camp, title: 'X', status: 'completed' })
      expect(svc.setStatus(q.id, 'in-progress').status).toBe('in-progress')
    })
  })

  describe('objectives', () => {
    it('addObjective rejects empty text', () => {
      const q = svc.create({ campaignId: camp, title: 'X' })
      expect(() => svc.addObjective(q.id, '   ')).toThrow(ValidationError)
    })

    it('addObjective appends a new one', () => {
      const q = svc.create({ campaignId: camp, title: 'X' })
      const updated = svc.addObjective(q.id, 'find the gate')
      expect(updated.objectives).toHaveLength(1)
      expect(updated.objectives[0]?.completed).toBe(false)
    })

    it('toggleObjective flips done', () => {
      const q = svc.create({ campaignId: camp, title: 'X' })
      const u1 = svc.addObjective(q.id, 'a')
      const id = u1.objectives[0]!.id
      const u2 = svc.toggleObjective(q.id, id)
      expect(u2.objectives[0]?.completed).toBe(true)
      const u3 = svc.toggleObjective(q.id, id)
      expect(u3.objectives[0]?.completed).toBe(false)
    })

    it('removeObjective drops by id', () => {
      const q = svc.create({ campaignId: camp, title: 'X' })
      const u1 = svc.addObjective(q.id, 'a')
      const id = u1.objectives[0]!.id
      const u2 = svc.removeObjective(q.id, id)
      expect(u2.objectives).toHaveLength(0)
    })
  })

  describe('get / tryGet / delete / removeAllForCampaign', () => {
    it('get throws', () => {
      // @ts-expect-error
      expect(() => svc.get('qst_NOPE000000' as never)).toThrow(NotFoundError)
    })

    it('tryGet null', () => {
      // @ts-expect-error
      expect(svc.tryGet('qst_NOPE000000' as never)).toBe(null)
    })

    it('removeAllForCampaign scopes', () => {
      svc.create({ campaignId: camp, title: 'a' })
      svc.create({ campaignId: other, title: 'b' })
      expect(svc.removeAllForCampaign(camp)).toBe(1)
      expect(svc.listForCampaign(other)).toHaveLength(1)
    })
  })
})
