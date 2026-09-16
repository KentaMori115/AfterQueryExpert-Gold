import { beforeEach, describe, expect, it } from 'vitest'

import { asCampaignId, asCharacterId } from '../ids'
import { NotFoundError, ValidationError } from '../lib/errors'
import { MemoryStore } from '../persistence/storage'

import { ItemService } from './item-service'

describe('ItemService', () => {
  const camp = asCampaignId('camp_TEST123456')
  const other = asCampaignId('camp_OTHER12345')
  const owner = asCharacterId('char_OWNER00000')

  let store: MemoryStore
  let svc: ItemService

  beforeEach(() => {
    store = new MemoryStore()
    svc = new ItemService(store)
  })

  describe('create', () => {
    it('builds with defaults', () => {
      const i = svc.create({ campaignId: camp, name: 'Sword' })
      expect(i.kind).toBe('misc')
      expect(i.rarity).toBe('common')
      expect(i.ownerId).toBe(null)
    })

    it('rejects empty name', () => {
      expect(() => svc.create({ campaignId: camp, name: '  ' })).toThrow(ValidationError)
    })
  })

  describe('list helpers', () => {
    it('unownedFor filters', () => {
      svc.create({ campaignId: camp, name: 'a' })
      svc.create({ campaignId: camp, name: 'b', ownerId: owner })
      expect(svc.unownedFor(camp)).toHaveLength(1)
    })

    it('ownedBy returns matching', () => {
      svc.create({ campaignId: camp, name: 'a', ownerId: owner })
      svc.create({ campaignId: camp, name: 'b' })
      expect(svc.ownedBy(owner)).toHaveLength(1)
    })

    it('totalValueFor sums up gp', () => {
      svc.create({ campaignId: camp, name: 'a', valueGp: 100 })
      svc.create({ campaignId: camp, name: 'b', valueGp: 250 })
      expect(svc.totalValueFor(camp)).toBe(350)
    })
  })

  describe('giveTo / setAttuned', () => {
    it('giveTo updates the owner and clears attunement', () => {
      const i = svc.create({ campaignId: camp, name: 'X', magical: true })
      svc.giveTo(i.id, owner)
      svc.setAttuned(i.id, true)
      expect(svc.get(i.id).attuned).toBe(true)
      const passed = svc.giveTo(i.id, null)
      expect(passed.ownerId).toBe(null)
      expect(passed.attuned).toBe(false)
    })

    it('setAttuned rejects non-magical', () => {
      const i = svc.create({ campaignId: camp, name: 'X', ownerId: owner })
      expect(() => svc.setAttuned(i.id, true)).toThrow(ValidationError)
    })

    it('setAttuned rejects ownerless', () => {
      const i = svc.create({ campaignId: camp, name: 'X', magical: true })
      expect(() => svc.setAttuned(i.id, true)).toThrow(ValidationError)
    })

    it('setAttuned no-op when state matches', () => {
      const i = svc.create({ campaignId: camp, name: 'X' })
      const again = svc.setAttuned(i.id, false)
      expect(again.updatedAt).toBe(i.updatedAt)
    })
  })

  describe('get / tryGet / update / delete', () => {
    it('get throws', () => {
      // @ts-expect-error
      expect(() => svc.get('itm_NOPE000000' as never)).toThrow(NotFoundError)
    })

    it('tryGet null', () => {
      // @ts-expect-error
      expect(svc.tryGet('itm_NOPE000000' as never)).toBe(null)
    })

    it('update changes name', () => {
      const i = svc.create({ campaignId: camp, name: 'Old' })
      expect(svc.update(i.id, { campaignId: camp, name: 'New' }).name).toBe('New')
    })

    it('removeAllForCampaign scopes', () => {
      svc.create({ campaignId: camp, name: 'a' })
      svc.create({ campaignId: other, name: 'b' })
      expect(svc.removeAllForCampaign(camp)).toBe(1)
      expect(svc.listForCampaign(other)).toHaveLength(1)
    })
  })
})
