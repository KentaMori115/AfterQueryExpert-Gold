import { beforeEach, describe, expect, it } from 'vitest'

import { asCampaignId, asCharacterId } from '../ids'
import { NotFoundError, ValidationError } from '../lib/errors'
import { MemoryStore } from '../persistence/storage'

import { SessionService } from './session-service'

describe('SessionService', () => {
  const camp = asCampaignId('camp_FROZEN1234')
  const other = asCampaignId('camp_OTHER12345')

  let store: MemoryStore
  let svc: SessionService

  beforeEach(() => {
    store = new MemoryStore()
    svc = new SessionService(store)
  })

  describe('create', () => {
    it('builds a session and assigns ordinal 1 for the first one', () => {
      const s = svc.create({ campaignId: camp, title: 'Opener', playedAt: '2025-03-01T20:00:00Z' })
      expect(s.id).toMatch(/^ses_/)
      expect(s.number).toBe(1)
      expect(s.title).toBe('Opener')
      expect(s.durationMinutes).toBe(0)
      expect(s.attendees).toEqual([])
    })

    it('increments the number per campaign', () => {
      svc.create({ campaignId: camp, title: 'one', playedAt: '2025-03-01T20:00:00Z' })
      const s2 = svc.create({ campaignId: camp, title: 'two', playedAt: '2025-03-08T20:00:00Z' })
      expect(s2.number).toBe(2)
    })

    it('numbers are scoped per campaign', () => {
      svc.create({ campaignId: camp, title: 'one', playedAt: '2025-03-01T20:00:00Z' })
      const o = svc.create({ campaignId: other, title: 'first', playedAt: '2025-03-01T20:00:00Z' })
      expect(o.number).toBe(1)
    })

    it('rejects empty title', () => {
      expect(() =>
        svc.create({ campaignId: camp, title: '   ', playedAt: '2025-03-01T20:00:00Z' }),
      ).toThrow(ValidationError)
    })

    it('rejects unparseable date', () => {
      expect(() =>
        svc.create({ campaignId: camp, title: 'x', playedAt: 'tomorrow' }),
      ).toThrow(ValidationError)
    })
  })

  describe('listForCampaign / latestForCampaign / count', () => {
    it('partitions by campaign', () => {
      svc.create({ campaignId: camp, title: 'a', playedAt: '2025-03-01T20:00:00Z' })
      svc.create({ campaignId: other, title: 'b', playedAt: '2025-03-01T20:00:00Z' })
      expect(svc.listForCampaign(camp)).toHaveLength(1)
      expect(svc.countForCampaign(camp)).toBe(1)
    })

    it('returns latest N descending by playedAt', () => {
      svc.create({ campaignId: camp, title: 'a', playedAt: '2025-03-01T20:00:00Z' })
      svc.create({ campaignId: camp, title: 'b', playedAt: '2025-04-01T20:00:00Z' })
      svc.create({ campaignId: camp, title: 'c', playedAt: '2025-02-01T20:00:00Z' })
      const latest = svc.latestForCampaign(camp, 2)
      expect(latest.map((s) => s.title)).toEqual(['b', 'a'])
    })
  })

  describe('get / tryGet', () => {
    it('throws on missing', () => {
      // @ts-expect-error
      expect(() => svc.get('ses_NOPE000000' as never)).toThrow(NotFoundError)
    })

    it('returns null on tryGet missing', () => {
      // @ts-expect-error
      expect(svc.tryGet('ses_NOPE000000' as never)).toBe(null)
    })
  })

  describe('update', () => {
    it('changes title and bumps updatedAt', async () => {
      const s = svc.create({ campaignId: camp, title: 'Old', playedAt: '2025-03-01T20:00:00Z' })
      await new Promise((r) => setTimeout(r, 5))
      const u = svc.update(s.id, { campaignId: camp, title: 'New', playedAt: '2025-03-01T20:00:00Z' })
      expect(u.title).toBe('New')
      expect(u.updatedAt >= s.updatedAt).toBe(true)
    })

    it('keeps the session number unchanged', () => {
      const s = svc.create({ campaignId: camp, title: 'X', playedAt: '2025-03-01T20:00:00Z' })
      const u = svc.update(s.id, { campaignId: camp, title: 'X', playedAt: '2025-03-01T20:00:00Z' })
      expect(u.number).toBe(s.number)
    })
  })

  describe('setAttendance', () => {
    it('adds a character to attendees', () => {
      const s = svc.create({ campaignId: camp, title: 'X', playedAt: '2025-03-01T20:00:00Z' })
      const next = svc.setAttendance(s.id, asCharacterId('char_PC1'), true)
      expect(next.attendees).toContain(asCharacterId('char_PC1'))
    })

    it('removes a character from attendees', () => {
      const s = svc.create({
        campaignId: camp,
        title: 'X',
        playedAt: '2025-03-01T20:00:00Z',
        attendees: [asCharacterId('char_PC1')],
      })
      const next = svc.setAttendance(s.id, asCharacterId('char_PC1'), false)
      expect(next.attendees).not.toContain(asCharacterId('char_PC1'))
    })

    it('no-ops when state matches', () => {
      const s = svc.create({ campaignId: camp, title: 'X', playedAt: '2025-03-01T20:00:00Z' })
      const again = svc.setAttendance(s.id, asCharacterId('char_PC1'), false)
      expect(again.updatedAt).toBe(s.updatedAt)
    })
  })

  describe('updateLog', () => {
    it('replaces the log text', () => {
      const s = svc.create({ campaignId: camp, title: 'X', playedAt: '2025-03-01T20:00:00Z' })
      const next = svc.updateLog(s.id, 'They opened the gate.')
      expect(next.log).toBe('They opened the gate.')
    })

    it('no-ops when log unchanged', () => {
      const s = svc.create({ campaignId: camp, title: 'X', playedAt: '2025-03-01T20:00:00Z' })
      const again = svc.updateLog(s.id, '')
      expect(again.updatedAt).toBe(s.updatedAt)
    })
  })

  describe('delete / removeAllForCampaign', () => {
    it('deletes one', () => {
      const s = svc.create({ campaignId: camp, title: 'X', playedAt: '2025-03-01T20:00:00Z' })
      svc.delete(s.id)
      expect(svc.tryGet(s.id)).toBe(null)
    })

    it('removeAllForCampaign drops only that campaigns sessions', () => {
      svc.create({ campaignId: camp, title: 'a', playedAt: '2025-03-01T20:00:00Z' })
      svc.create({ campaignId: camp, title: 'b', playedAt: '2025-04-01T20:00:00Z' })
      svc.create({ campaignId: other, title: 'c', playedAt: '2025-03-01T20:00:00Z' })
      expect(svc.removeAllForCampaign(camp)).toBe(2)
      expect(svc.listForCampaign(camp)).toEqual([])
      expect(svc.listForCampaign(other)).toHaveLength(1)
    })
  })
})
