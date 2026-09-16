import { beforeEach, describe, expect, it } from 'vitest'

import { asCampaignId } from '../ids'
import { NotFoundError, ValidationError } from '../lib/errors'
import { MemoryStore } from '../persistence/storage'

import { CharacterService } from './character-service'

describe('CharacterService', () => {
  const camp = asCampaignId('camp_FROZEN1234')
  const other = asCampaignId('camp_OTHER12345')

  let store: MemoryStore
  let svc: CharacterService

  beforeEach(() => {
    store = new MemoryStore()
    svc = new CharacterService(store)
  })

  describe('create', () => {
    it('builds a character with sensible defaults', () => {
      const c = svc.create({ campaignId: camp, name: 'Iris Thorne' })
      expect(c.id).toMatch(/^char_/)
      expect(c.campaignId).toBe(camp)
      expect(c.kind).toBe('npc')
      expect(c.name).toBe('Iris Thorne')
      expect(c.level).toBe(1)
      expect(c.disposition).toBe('unknown')
      expect(c.alive).toBe(true)
      expect(c.factionId).toBe(null)
      expect(c.homeId).toBe(null)
      expect(c.blurb).toBe('')
    })

    it('honours supplied fields', () => {
      const c = svc.create({
        campaignId: camp,
        name: 'Kael',
        kind: 'pc',
        level: 7,
        disposition: 'allied',
        ancestry: 'human',
        vocation: 'warden',
        pronouns: 'he/him',
      })
      expect(c.kind).toBe('pc')
      expect(c.level).toBe(7)
      expect(c.disposition).toBe('allied')
      expect(c.ancestry).toBe('human')
      expect(c.vocation).toBe('warden')
      expect(c.pronouns).toBe('he/him')
    })

    it('rejects empty name with ValidationError', () => {
      expect(() => svc.create({ campaignId: camp, name: '   ' })).toThrow(ValidationError)
    })

    it('rejects out-of-range level', () => {
      expect(() => svc.create({ campaignId: camp, name: 'x', level: -2 })).toThrow(ValidationError)
    })

    it('persists across new service instances', () => {
      const c = svc.create({ campaignId: camp, name: 'Persistent' })
      const fresh = new CharacterService(store)
      expect(fresh.get(c.id).name).toBe('Persistent')
    })
  })

  describe('listForCampaign / countForCampaign', () => {
    it('returns only the characters owned by that campaign', () => {
      svc.create({ campaignId: camp, name: 'A' })
      svc.create({ campaignId: camp, name: 'B' })
      svc.create({ campaignId: other, name: 'C' })
      const mine = svc.listForCampaign(camp)
      expect(mine.map((c) => c.name).sort()).toEqual(['A', 'B'])
      expect(svc.countForCampaign(camp)).toBe(2)
      expect(svc.countForCampaign(other)).toBe(1)
    })

    it('returns empty for an unknown campaign', () => {
      expect(svc.listForCampaign(asCampaignId('camp_NOPE000000'))).toEqual([])
    })
  })

  describe('get / tryGet', () => {
    it('get throws NotFound for unknown id', () => {
      // @ts-expect-error bypass brand
      expect(() => svc.get('char_NOPE000000' as never)).toThrow(NotFoundError)
    })

    it('tryGet returns null for unknown id', () => {
      // @ts-expect-error bypass brand
      expect(svc.tryGet('char_NOPE000000' as never)).toBe(null)
    })
  })

  describe('update', () => {
    it('changes editable fields and bumps updatedAt', async () => {
      const c = svc.create({ campaignId: camp, name: 'Old' })
      await new Promise((r) => setTimeout(r, 5))
      const updated = svc.update(c.id, { campaignId: camp, name: 'New', level: 4 })
      expect(updated.name).toBe('New')
      expect(updated.level).toBe(4)
      expect(updated.updatedAt >= c.updatedAt).toBe(true)
    })

    it('throws when target does not exist', () => {
      // @ts-expect-error bypass brand
      expect(() => svc.update('char_NOPE000000' as never, { campaignId: camp, name: 'x' })).toThrow(
        NotFoundError,
      )
    })

    it('preserves fields that are not in the update payload', () => {
      const c = svc.create({
        campaignId: camp,
        name: 'X',
        ancestry: 'elf',
        vocation: 'mage',
        level: 9,
      })
      const updated = svc.update(c.id, { campaignId: camp, name: 'X2' })
      expect(updated.ancestry).toBe('elf')
      expect(updated.vocation).toBe('mage')
      expect(updated.level).toBe(9)
    })
  })

  describe('setDisposition', () => {
    it('changes the disposition', () => {
      const c = svc.create({ campaignId: camp, name: 'X' })
      const moved = svc.setDisposition(c.id, 'hostile')
      expect(moved.disposition).toBe('hostile')
    })
  })

  describe('markDeceased / revive', () => {
    it('marks alive=false', () => {
      const c = svc.create({ campaignId: camp, name: 'X' })
      const dead = svc.markDeceased(c.id)
      expect(dead.alive).toBe(false)
    })

    it('no-ops markDeceased on already-dead characters', () => {
      const c = svc.create({ campaignId: camp, name: 'X' })
      const dead = svc.markDeceased(c.id)
      const again = svc.markDeceased(c.id)
      expect(again.updatedAt).toBe(dead.updatedAt)
    })

    it('revives a dead character', () => {
      const c = svc.create({ campaignId: camp, name: 'X' })
      svc.markDeceased(c.id)
      const back = svc.revive(c.id)
      expect(back.alive).toBe(true)
    })

    it('no-ops revive on already-alive characters', () => {
      const c = svc.create({ campaignId: camp, name: 'X' })
      const again = svc.revive(c.id)
      expect(again.updatedAt).toBe(c.updatedAt)
    })
  })

  describe('delete / removeAllForCampaign', () => {
    it('removes one character', () => {
      const c = svc.create({ campaignId: camp, name: 'X' })
      svc.delete(c.id)
      expect(svc.tryGet(c.id)).toBe(null)
    })

    it('throws on delete of unknown', () => {
      // @ts-expect-error bypass brand
      expect(() => svc.delete('char_NOPE000000' as never)).toThrow(NotFoundError)
    })

    it('removeAllForCampaign drops every character of that campaign and returns the count', () => {
      svc.create({ campaignId: camp, name: 'A' })
      svc.create({ campaignId: camp, name: 'B' })
      svc.create({ campaignId: other, name: 'C' })
      const removed = svc.removeAllForCampaign(camp)
      expect(removed).toBe(2)
      expect(svc.listForCampaign(camp)).toEqual([])
      expect(svc.listForCampaign(other)).toHaveLength(1)
    })
  })
})
