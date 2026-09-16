import { beforeEach, describe, expect, it } from 'vitest'

import { asCampaignId, asCharacterId } from '../ids'
import { NotFoundError, ValidationError } from '../lib/errors'
import { MemoryStore } from '../persistence/storage'

import { FactionService } from './faction-service'

describe('FactionService', () => {
  const camp = asCampaignId('camp_FROZEN1234')
  const other = asCampaignId('camp_OTHER12345')

  let store: MemoryStore
  let svc: FactionService

  beforeEach(() => {
    store = new MemoryStore()
    svc = new FactionService(store)
  })

  describe('create', () => {
    it('builds a faction with sensible defaults', () => {
      const f = svc.create({ campaignId: camp, name: 'Crimson Order' })
      expect(f.id).toMatch(/^fac_/)
      expect(f.alignment).toBe('unknown')
      expect(f.scope).toBe('regional')
      expect(f.influence).toBe(25)
      expect(f.active).toBe(true)
      expect(f.leaderId).toBe(null)
      expect(f.seatId).toBe(null)
    })

    it('honours supplied values', () => {
      const f = svc.create({
        campaignId: camp,
        name: 'X',
        alignment: 'evil',
        scope: 'global',
        influence: 90,
        motto: 'so it begins',
      })
      expect(f.alignment).toBe('evil')
      expect(f.scope).toBe('global')
      expect(f.influence).toBe(90)
      expect(f.motto).toBe('so it begins')
    })

    it('clamps oversized influence inside the schema (schema rejects > 100)', () => {
      expect(() => svc.create({ campaignId: camp, name: 'X', influence: 150 })).toThrow(ValidationError)
    })

    it('rejects empty name', () => {
      expect(() => svc.create({ campaignId: camp, name: '  ' })).toThrow(ValidationError)
    })

    it('persists across new service instances', () => {
      const f = svc.create({ campaignId: camp, name: 'Persistent' })
      const fresh = new FactionService(store)
      expect(fresh.get(f.id).name).toBe('Persistent')
    })
  })

  describe('listForCampaign / activeFor / count', () => {
    it('partitions by campaign', () => {
      svc.create({ campaignId: camp, name: 'A' })
      svc.create({ campaignId: camp, name: 'B', active: false })
      svc.create({ campaignId: other, name: 'C' })
      expect(svc.listForCampaign(camp)).toHaveLength(2)
      expect(svc.activeFor(camp)).toHaveLength(1)
      expect(svc.countForCampaign(other)).toBe(1)
    })
  })

  describe('get / tryGet', () => {
    it('get throws on missing', () => {
      // @ts-expect-error bypass brand
      expect(() => svc.get('fac_NOPE000000' as never)).toThrow(NotFoundError)
    })

    it('tryGet returns null on missing', () => {
      // @ts-expect-error bypass brand
      expect(svc.tryGet('fac_NOPE000000' as never)).toBe(null)
    })
  })

  describe('update', () => {
    it('mutates fields and bumps updatedAt', async () => {
      const f = svc.create({ campaignId: camp, name: 'Old' })
      await new Promise((r) => setTimeout(r, 5))
      const u = svc.update(f.id, { campaignId: camp, name: 'New', influence: 70 })
      expect(u.name).toBe('New')
      expect(u.influence).toBe(70)
      expect(u.updatedAt >= f.updatedAt).toBe(true)
    })

    it('preserves leaderId when not supplied', () => {
      const f = svc.create({ campaignId: camp, name: 'X', leaderId: asCharacterId('char_LEADER0000') })
      const u = svc.update(f.id, { campaignId: camp, name: 'X' })
      expect(u.leaderId).toBe(asCharacterId('char_LEADER0000'))
    })
  })

  describe('adjustInfluence', () => {
    it('moves influence within bounds', () => {
      const f = svc.create({ campaignId: camp, name: 'X', influence: 30 })
      const up = svc.adjustInfluence(f.id, 20)
      expect(up.influence).toBe(50)
      const cap = svc.adjustInfluence(f.id, 200)
      expect(cap.influence).toBe(100)
      const floor = svc.adjustInfluence(f.id, -1000)
      expect(floor.influence).toBe(0)
    })

    it('no-ops if already at the bound for that direction', () => {
      const f = svc.create({ campaignId: camp, name: 'X', influence: 100 })
      const again = svc.adjustInfluence(f.id, 10)
      expect(again.updatedAt).toBe(f.updatedAt)
    })
  })

  describe('setActive / setLeader', () => {
    it('toggles active', () => {
      const f = svc.create({ campaignId: camp, name: 'X' })
      const off = svc.setActive(f.id, false)
      expect(off.active).toBe(false)
    })

    it('no-ops setActive if state matches', () => {
      const f = svc.create({ campaignId: camp, name: 'X' })
      const again = svc.setActive(f.id, true)
      expect(again.updatedAt).toBe(f.updatedAt)
    })

    it('clears leader on null', () => {
      const leader = asCharacterId('char_X0000XXXXX')
      const f = svc.create({ campaignId: camp, name: 'X', leaderId: leader })
      const cleared = svc.setLeader(f.id, null)
      expect(cleared.leaderId).toBe(null)
    })
  })

  describe('delete / removeAllForCampaign', () => {
    it('deletes one', () => {
      const f = svc.create({ campaignId: camp, name: 'X' })
      svc.delete(f.id)
      expect(svc.tryGet(f.id)).toBe(null)
    })

    it('removeAllForCampaign drops just that campaign', () => {
      svc.create({ campaignId: camp, name: 'A' })
      svc.create({ campaignId: camp, name: 'B' })
      svc.create({ campaignId: other, name: 'C' })
      expect(svc.removeAllForCampaign(camp)).toBe(2)
      expect(svc.listForCampaign(camp)).toEqual([])
      expect(svc.listForCampaign(other)).toHaveLength(1)
    })
  })
})
