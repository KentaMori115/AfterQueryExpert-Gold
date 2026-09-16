import { beforeEach, describe, expect, it } from 'vitest'

import { asCampaignId } from '../ids'
import { NotFoundError, ValidationError } from '../lib/errors'
import { MemoryStore } from '../persistence/storage'

import { ArcService } from './arc-service'

describe('ArcService', () => {
  const camp = asCampaignId('camp_TEST123456')
  const other = asCampaignId('camp_OTHER12345')

  let store: MemoryStore
  let svc: ArcService

  beforeEach(() => {
    store = new MemoryStore()
    svc = new ArcService(store)
  })

  describe('create', () => {
    it('builds an arc with defaults', () => {
      const a = svc.create({ campaignId: camp, title: 'The Long Winter' })
      expect(a.id).toMatch(/^arc_/)
      expect(a.status).toBe('seeded')
      expect(a.tension).toBe('low')
      expect(a.synopsis).toBe('')
    })

    it('honours supplied status and tension', () => {
      const a = svc.create({ campaignId: camp, title: 'X', status: 'active', tension: 'high' })
      expect(a.status).toBe('active')
      expect(a.tension).toBe('high')
    })

    it('rejects empty title', () => {
      expect(() => svc.create({ campaignId: camp, title: '   ' })).toThrow(ValidationError)
    })
  })

  describe('listForCampaign / byStatus / liveCountFor', () => {
    it('partitions by campaign', () => {
      svc.create({ campaignId: camp, title: 'A' })
      svc.create({ campaignId: other, title: 'B' })
      expect(svc.listForCampaign(camp)).toHaveLength(1)
    })

    it('groups by status within a campaign', () => {
      svc.create({ campaignId: camp, title: 'X', status: 'active' })
      svc.create({ campaignId: camp, title: 'Y', status: 'active' })
      svc.create({ campaignId: camp, title: 'Z', status: 'resolved' })
      expect(svc.byStatus(camp, 'active')).toHaveLength(2)
      expect(svc.byStatus(camp, 'resolved')).toHaveLength(1)
      expect(svc.byStatus(camp, 'shelved')).toHaveLength(0)
    })

    it('liveCountFor excludes resolved and shelved', () => {
      svc.create({ campaignId: camp, title: 'a', status: 'active' })
      svc.create({ campaignId: camp, title: 'b', status: 'seeded' })
      svc.create({ campaignId: camp, title: 'c', status: 'resolved' })
      svc.create({ campaignId: camp, title: 'd', status: 'shelved' })
      expect(svc.liveCountFor(camp)).toBe(2)
    })
  })

  describe('get / tryGet', () => {
    it('throws on missing', () => {
      // @ts-expect-error
      expect(() => svc.get('arc_NOPE000000' as never)).toThrow(NotFoundError)
    })
    it('tryGet returns null on missing', () => {
      // @ts-expect-error
      expect(svc.tryGet('arc_NOPE000000' as never)).toBe(null)
    })
  })

  describe('update / setStatus / setTension', () => {
    it('changes fields', () => {
      const a = svc.create({ campaignId: camp, title: 'Old' })
      const u = svc.update(a.id, { campaignId: camp, title: 'New', status: 'climbing' })
      expect(u.title).toBe('New')
      expect(u.status).toBe('climbing')
    })

    it('setStatus moves it', () => {
      const a = svc.create({ campaignId: camp, title: 'X', status: 'active' })
      const moved = svc.setStatus(a.id, 'resolved')
      expect(moved.status).toBe('resolved')
    })

    it('setStatus no-ops if same', () => {
      const a = svc.create({ campaignId: camp, title: 'X', status: 'active' })
      const again = svc.setStatus(a.id, 'active')
      expect(again.updatedAt).toBe(a.updatedAt)
    })

    it('setTension cycles', () => {
      const a = svc.create({ campaignId: camp, title: 'X', tension: 'low' })
      expect(svc.setTension(a.id, 'breaking').tension).toBe('breaking')
    })
  })

  describe('delete / removeAllForCampaign', () => {
    it('deletes one', () => {
      const a = svc.create({ campaignId: camp, title: 'X' })
      svc.delete(a.id)
      expect(svc.tryGet(a.id)).toBe(null)
    })

    it('removeAllForCampaign drops just that campaign', () => {
      svc.create({ campaignId: camp, title: 'A' })
      svc.create({ campaignId: other, title: 'B' })
      expect(svc.removeAllForCampaign(camp)).toBe(1)
      expect(svc.listForCampaign(other)).toHaveLength(1)
    })
  })
})
