import { beforeEach, describe, expect, it } from 'vitest'

import { asCampaignId } from '../ids'
import { NotFoundError, ValidationError } from '../lib/errors'
import { MemoryStore } from '../persistence/storage'

import { LoreService } from './lore-service'

describe('LoreService', () => {
  const camp = asCampaignId('camp_TEST123456')
  const other = asCampaignId('camp_OTHER12345')

  let store: MemoryStore
  let svc: LoreService

  beforeEach(() => {
    store = new MemoryStore()
    svc = new LoreService(store)
  })

  describe('create', () => {
    it('builds with defaults', () => {
      const e = svc.create({ campaignId: camp, title: 'Origin' })
      expect(e.category).toBe('misc')
      expect(e.revealed).toBe(false)
      expect(e.tags).toEqual([])
    })

    it('normalises tags', () => {
      const e = svc.create({ campaignId: camp, title: 'X', tags: ['Frost', 'FROST', 'treaty'] })
      expect(e.tags).toEqual(['frost', 'treaty'])
    })

    it('rejects empty title', () => {
      expect(() => svc.create({ campaignId: camp, title: '   ' })).toThrow(ValidationError)
    })
  })

  describe('list helpers', () => {
    it('revealedFor filters', () => {
      svc.create({ campaignId: camp, title: 'a', revealed: true })
      svc.create({ campaignId: camp, title: 'b' })
      expect(svc.revealedFor(camp)).toHaveLength(1)
    })

    it('taggedFor matches', () => {
      svc.create({ campaignId: camp, title: 'a', tags: ['frost'] })
      svc.create({ campaignId: camp, title: 'b', tags: ['fire'] })
      expect(svc.taggedFor(camp, 'frost')).toHaveLength(1)
    })

    it('searchFor matches across fields', () => {
      svc.create({ campaignId: camp, title: 'The Frozen Gate', body: 'snow lore' })
      svc.create({ campaignId: camp, title: 'Other', body: 'dragons' })
      expect(svc.searchFor(camp, 'frozen')).toHaveLength(1)
      expect(svc.searchFor(camp, 'snow')).toHaveLength(1)
      expect(svc.searchFor(camp, 'dragons')).toHaveLength(1)
    })

    it('uniqueTagsFor collects sorted distinct tags', () => {
      svc.create({ campaignId: camp, title: 'a', tags: ['frost', 'treaty'] })
      svc.create({ campaignId: camp, title: 'b', tags: ['frost', 'guild'] })
      expect(svc.uniqueTagsFor(camp)).toEqual(['frost', 'guild', 'treaty'])
    })
  })

  describe('setRevealed / setPinned', () => {
    it('flips revealed', () => {
      const e = svc.create({ campaignId: camp, title: 'X' })
      expect(svc.setRevealed(e.id, true).revealed).toBe(true)
    })

    it('flips pinned', () => {
      const e = svc.create({ campaignId: camp, title: 'X' })
      expect(svc.setPinned(e.id, true).pinned).toBe(true)
    })

    it('no-op when state matches', () => {
      const e = svc.create({ campaignId: camp, title: 'X' })
      const again = svc.setRevealed(e.id, false)
      expect(again.updatedAt).toBe(e.updatedAt)
    })
  })

  describe('get / tryGet / update / delete / removeAllForCampaign', () => {
    it('get throws on missing', () => {
      // @ts-expect-error
      expect(() => svc.get('lor_NOPE000000' as never)).toThrow(NotFoundError)
    })

    it('tryGet returns null', () => {
      // @ts-expect-error
      expect(svc.tryGet('lor_NOPE000000' as never)).toBe(null)
    })

    it('update changes fields', () => {
      const e = svc.create({ campaignId: camp, title: 'Old' })
      expect(svc.update(e.id, { campaignId: camp, title: 'New' }).title).toBe('New')
    })

    it('removeAllForCampaign scopes', () => {
      svc.create({ campaignId: camp, title: 'a' })
      svc.create({ campaignId: other, title: 'b' })
      expect(svc.removeAllForCampaign(camp)).toBe(1)
      expect(svc.listForCampaign(other)).toHaveLength(1)
    })
  })
})
