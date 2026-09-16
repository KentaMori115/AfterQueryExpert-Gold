import { beforeEach, describe, expect, it } from 'vitest'

import { asCampaignId, asLocationId } from '../ids'
import { ConflictError, NotFoundError, ValidationError } from '../lib/errors'
import { MemoryStore } from '../persistence/storage'

import { LocationService } from './location-service'

describe('LocationService', () => {
  const camp = asCampaignId('camp_FROZEN1234')
  const other = asCampaignId('camp_OTHER12345')

  let store: MemoryStore
  let svc: LocationService

  beforeEach(() => {
    store = new MemoryStore()
    svc = new LocationService(store)
  })

  describe('create', () => {
    it('builds a location with defaults', () => {
      const l = svc.create({ campaignId: camp, name: 'Frostfell' })
      expect(l.id).toMatch(/^loc_/)
      expect(l.kind).toBe('region')
      expect(l.parentId).toBe(null)
      expect(l.visited).toBe(false)
    })

    it('honours supplied parent within the same campaign', () => {
      const root = svc.create({ campaignId: camp, name: 'Continent' })
      const child = svc.create({ campaignId: camp, name: 'City', parentId: root.id })
      expect(child.parentId).toBe(root.id)
    })

    it('rejects an unknown parent', () => {
      expect(() =>
        svc.create({ campaignId: camp, name: 'X', parentId: asLocationId('loc_NOPE000000') }),
      ).toThrow(ValidationError)
    })

    it('rejects a parent that belongs to a different campaign', () => {
      const otherRoot = svc.create({ campaignId: other, name: 'OtherWorld' })
      expect(() =>
        svc.create({ campaignId: camp, name: 'X', parentId: otherRoot.id }),
      ).toThrow(ConflictError)
    })

    it('rejects empty name', () => {
      expect(() => svc.create({ campaignId: camp, name: '   ' })).toThrow(ValidationError)
    })
  })

  describe('listForCampaign / childrenOf', () => {
    it('returns only the campaign scope', () => {
      svc.create({ campaignId: camp, name: 'A' })
      svc.create({ campaignId: other, name: 'B' })
      expect(svc.listForCampaign(camp)).toHaveLength(1)
    })

    it('returns the direct children of a parent', () => {
      const root = svc.create({ campaignId: camp, name: 'Root' })
      svc.create({ campaignId: camp, name: 'C1', parentId: root.id })
      svc.create({ campaignId: camp, name: 'C2', parentId: root.id })
      expect(svc.childrenOf(root.id)).toHaveLength(2)
    })
  })

  describe('get / tryGet', () => {
    it('get throws on missing', () => {
      // @ts-expect-error bypass brand
      expect(() => svc.get('loc_NOPE000000' as never)).toThrow(NotFoundError)
    })

    it('tryGet returns null on missing', () => {
      // @ts-expect-error bypass brand
      expect(svc.tryGet('loc_NOPE000000' as never)).toBe(null)
    })
  })

  describe('update', () => {
    it('changes name and bumps updatedAt', async () => {
      const l = svc.create({ campaignId: camp, name: 'Old' })
      await new Promise((r) => setTimeout(r, 5))
      const u = svc.update(l.id, { campaignId: camp, name: 'New' })
      expect(u.name).toBe('New')
      expect(u.updatedAt >= l.updatedAt).toBe(true)
    })

    it('reparents to another in same campaign', () => {
      const a = svc.create({ campaignId: camp, name: 'A' })
      const b = svc.create({ campaignId: camp, name: 'B' })
      const moved = svc.update(b.id, { campaignId: camp, name: 'B', parentId: a.id })
      expect(moved.parentId).toBe(a.id)
    })

    it('rejects a reparent that would create a cycle', () => {
      const a = svc.create({ campaignId: camp, name: 'A' })
      const b = svc.create({ campaignId: camp, name: 'B', parentId: a.id })
      expect(() =>
        svc.update(a.id, { campaignId: camp, name: 'A', parentId: b.id }),
      ).toThrow(ConflictError)
    })

    it('rejects a reparent to a different campaign', () => {
      const local = svc.create({ campaignId: camp, name: 'Here' })
      const otherRoot = svc.create({ campaignId: other, name: 'OtherWorld' })
      expect(() =>
        svc.update(local.id, { campaignId: camp, name: 'Here', parentId: otherRoot.id }),
      ).toThrow(ConflictError)
    })
  })

  describe('setVisited / setParent', () => {
    it('toggles visited', () => {
      const l = svc.create({ campaignId: camp, name: 'X' })
      const v = svc.setVisited(l.id, true)
      expect(v.visited).toBe(true)
    })

    it('no-ops when visited is unchanged', () => {
      const l = svc.create({ campaignId: camp, name: 'X' })
      const v = svc.setVisited(l.id, false)
      expect(v.updatedAt).toBe(l.updatedAt)
    })

    it('reparents to root via null', () => {
      const root = svc.create({ campaignId: camp, name: 'Root' })
      const child = svc.create({ campaignId: camp, name: 'Child', parentId: root.id })
      const moved = svc.setParent(child.id, null)
      expect(moved.parentId).toBe(null)
    })
  })

  describe('delete', () => {
    it('removes a leaf', () => {
      const l = svc.create({ campaignId: camp, name: 'X' })
      svc.delete(l.id)
      expect(svc.tryGet(l.id)).toBe(null)
    })

    it('refuses to delete a parent without cascade', () => {
      const r = svc.create({ campaignId: camp, name: 'R' })
      svc.create({ campaignId: camp, name: 'C', parentId: r.id })
      expect(() => svc.delete(r.id)).toThrow(ConflictError)
    })

    it('deletes the whole subtree with cascade=true', () => {
      const r = svc.create({ campaignId: camp, name: 'R' })
      const c = svc.create({ campaignId: camp, name: 'C', parentId: r.id })
      const g = svc.create({ campaignId: camp, name: 'G', parentId: c.id })
      svc.delete(r.id, true)
      expect(svc.tryGet(r.id)).toBe(null)
      expect(svc.tryGet(c.id)).toBe(null)
      expect(svc.tryGet(g.id)).toBe(null)
    })

    it('removeAllForCampaign wipes scoped to campaign', () => {
      svc.create({ campaignId: camp, name: 'A' })
      svc.create({ campaignId: camp, name: 'B' })
      svc.create({ campaignId: other, name: 'C' })
      expect(svc.removeAllForCampaign(camp)).toBe(2)
      expect(svc.listForCampaign(other)).toHaveLength(1)
    })
  })
})
