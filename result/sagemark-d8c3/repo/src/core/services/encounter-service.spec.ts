import { beforeEach, describe, expect, it } from 'vitest'

import { asCampaignId, asSessionId } from '../ids'
import { NotFoundError, ValidationError } from '../lib/errors'
import { MemoryStore } from '../persistence/storage'

import { EncounterService } from './encounter-service'

describe('EncounterService', () => {
  const camp = asCampaignId('camp_TEST123456')
  const other = asCampaignId('camp_OTHER12345')
  const ses = asSessionId('ses_TESTABCDEF')

  let store: MemoryStore
  let svc: EncounterService

  beforeEach(() => {
    store = new MemoryStore()
    svc = new EncounterService(store)
  })

  describe('create', () => {
    it('builds an encounter with defaults', () => {
      const e = svc.create({ campaignId: camp, title: 'Goblins' })
      expect(e.id).toMatch(/^enc_/)
      expect(e.kind).toBe('combat')
      expect(e.difficulty).toBe('medium')
      expect(e.resolved).toBe(false)
      expect(e.initiative).toEqual([])
    })

    it('honours session linkage', () => {
      const e = svc.create({ campaignId: camp, title: 'X', sessionId: ses })
      expect(e.sessionId).toBe(ses)
    })

    it('rejects empty title', () => {
      expect(() => svc.create({ campaignId: camp, title: '   ' })).toThrow(ValidationError)
    })
  })

  describe('list helpers', () => {
    it('listForCampaign / unresolvedFor partition correctly', () => {
      svc.create({ campaignId: camp, title: 'open', resolved: false })
      svc.create({ campaignId: camp, title: 'closed', resolved: true })
      svc.create({ campaignId: other, title: 'else' })
      expect(svc.listForCampaign(camp)).toHaveLength(2)
      expect(svc.unresolvedFor(camp)).toHaveLength(1)
    })

    it('forSession only returns matching session', () => {
      svc.create({ campaignId: camp, title: 'a', sessionId: ses })
      svc.create({ campaignId: camp, title: 'b' })
      expect(svc.forSession(ses)).toHaveLength(1)
    })
  })

  describe('setInitiative / markResolved / update', () => {
    it('replaces initiative array', () => {
      const e = svc.create({ campaignId: camp, title: 'X' })
      const next = svc.setInitiative(e.id, [
        { characterId: null, name: 'goblin', initiative: 8, hp: 12, notes: '' },
      ])
      expect(next.initiative).toHaveLength(1)
    })

    it('marks resolved', () => {
      const e = svc.create({ campaignId: camp, title: 'X' })
      const m = svc.markResolved(e.id)
      expect(m.resolved).toBe(true)
    })

    it('markResolved no-ops if state matches', () => {
      const e = svc.create({ campaignId: camp, title: 'X' })
      const again = svc.markResolved(e.id, false)
      expect(again.updatedAt).toBe(e.updatedAt)
    })

    it('update changes title', () => {
      const e = svc.create({ campaignId: camp, title: 'Old' })
      const u = svc.update(e.id, { campaignId: camp, title: 'New' })
      expect(u.title).toBe('New')
    })
  })

  describe('get / tryGet / delete', () => {
    it('get throws on missing', () => {
      // @ts-expect-error
      expect(() => svc.get('enc_NOPE000000' as never)).toThrow(NotFoundError)
    })

    it('tryGet returns null', () => {
      // @ts-expect-error
      expect(svc.tryGet('enc_NOPE000000' as never)).toBe(null)
    })

    it('delete removes', () => {
      const e = svc.create({ campaignId: camp, title: 'X' })
      svc.delete(e.id)
      expect(svc.tryGet(e.id)).toBe(null)
    })

    it('removeAllForCampaign drops scoped', () => {
      svc.create({ campaignId: camp, title: 'a' })
      svc.create({ campaignId: camp, title: 'b' })
      svc.create({ campaignId: other, title: 'c' })
      expect(svc.removeAllForCampaign(camp)).toBe(2)
      expect(svc.listForCampaign(other)).toHaveLength(1)
    })
  })
})
