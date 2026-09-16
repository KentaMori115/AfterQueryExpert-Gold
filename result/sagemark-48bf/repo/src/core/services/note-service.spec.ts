import { beforeEach, describe, expect, it } from 'vitest'

import { asCampaignId, asCharacterId, asLocationId } from '../ids'
import { NotFoundError, ValidationError } from '../lib/errors'
import { MemoryStore } from '../persistence/storage'

import { NoteService } from './note-service'

describe('NoteService', () => {
  const camp = asCampaignId('camp_TESTABCDEF')
  const other = asCampaignId('camp_OTHER12345')
  const char = { kind: 'character' as const, id: asCharacterId('char_X') }
  const place = { kind: 'location' as const, id: asLocationId('loc_X') }

  let store: MemoryStore
  let svc: NoteService

  beforeEach(() => {
    store = new MemoryStore()
    svc = new NoteService(store)
  })

  describe('create', () => {
    it('builds with sensible defaults', () => {
      const n = svc.create({ campaignId: camp, target: char, body: 'hello' })
      expect(n.id).toMatch(/^not_/)
      expect(n.priority).toBe('normal')
      expect(n.pinned).toBe(false)
      expect(n.resolvedAt).toBe(null)
      expect(n.remindAt).toBe(null)
    })

    it('rejects empty body', () => {
      expect(() => svc.create({ campaignId: camp, target: char, body: '   ' })).toThrow(ValidationError)
    })

    it('accepts a remindAt timestamp', () => {
      const n = svc.create({
        campaignId: camp,
        target: char,
        body: 'check on this',
        remindAt: '2026-01-05T10:00:00Z',
      })
      expect(n.remindAt).not.toBeNull()
    })
  })

  describe('list helpers', () => {
    it('forTarget filters by kind + id', () => {
      svc.create({ campaignId: camp, target: char, body: 'a' })
      svc.create({ campaignId: camp, target: place, body: 'b' })
      svc.create({ campaignId: other, target: char, body: 'c' })
      expect(svc.forTarget(camp, char)).toHaveLength(1)
      expect(svc.forTarget(camp, place)).toHaveLength(1)
    })

    it('openFor excludes resolved', () => {
      const a = svc.create({ campaignId: camp, target: char, body: 'open' })
      const b = svc.create({ campaignId: camp, target: char, body: 'closed' })
      svc.resolve(b.id)
      const open = svc.openFor(camp)
      expect(open).toHaveLength(1)
      expect(open[0]?.id).toBe(a.id)
    })

    it('pinnedFor returns only open pinned notes', () => {
      const a = svc.create({ campaignId: camp, target: char, body: 'a', pinned: true })
      const b = svc.create({ campaignId: camp, target: char, body: 'b', pinned: true })
      svc.resolve(b.id)
      svc.create({ campaignId: camp, target: char, body: 'c' })
      expect(svc.pinnedFor(camp)).toHaveLength(1)
      expect(svc.pinnedFor(camp)[0]?.id).toBe(a.id)
    })

    it('overdueFor flags notes whose remindAt has passed', () => {
      svc.create({
        campaignId: camp,
        target: char,
        body: 'a',
        remindAt: '2026-01-05T10:00:00Z',
      })
      svc.create({
        campaignId: camp,
        target: char,
        body: 'b',
        remindAt: '2026-06-05T10:00:00Z',
      })
      const overdue = svc.overdueFor(camp, new Date('2026-02-01T00:00:00Z'))
      expect(overdue).toHaveLength(1)
    })
  })

  describe('mutations', () => {
    it('setPriority changes priority', () => {
      const n = svc.create({ campaignId: camp, target: char, body: 'x' })
      const upgraded = svc.setPriority(n.id, 'critical')
      expect(upgraded.priority).toBe('critical')
    })

    it('setPriority noops on same priority', () => {
      const n = svc.create({ campaignId: camp, target: char, body: 'x' })
      const again = svc.setPriority(n.id, 'normal')
      expect(again.updatedAt).toBe(n.updatedAt)
    })

    it('setPinned toggles', () => {
      const n = svc.create({ campaignId: camp, target: char, body: 'x' })
      expect(svc.setPinned(n.id, true).pinned).toBe(true)
    })

    it('resolve sets resolvedAt, reopen clears it', () => {
      const n = svc.create({ campaignId: camp, target: char, body: 'x' })
      const resolved = svc.resolve(n.id, new Date('2026-02-10T10:00:00Z'))
      expect(resolved.resolvedAt).not.toBeNull()
      const reopened = svc.reopen(n.id)
      expect(reopened.resolvedAt).toBe(null)
    })

    it('resolve on already resolved is a no op', () => {
      const n = svc.create({ campaignId: camp, target: char, body: 'x' })
      const first = svc.resolve(n.id)
      const second = svc.resolve(n.id)
      expect(second.resolvedAt).toBe(first.resolvedAt)
    })

    it('update writes a new body and bumps updatedAt', async () => {
      const n = svc.create({ campaignId: camp, target: char, body: 'old' })
      await new Promise((r) => setTimeout(r, 5))
      const updated = svc.update(n.id, { campaignId: camp, target: char, body: 'new' })
      expect(updated.body).toBe('new')
      expect(updated.updatedAt >= n.updatedAt).toBe(true)
    })
  })

  describe('removeAll variants', () => {
    it('removeAllForCampaign scopes correctly', () => {
      svc.create({ campaignId: camp, target: char, body: 'a' })
      svc.create({ campaignId: camp, target: char, body: 'b' })
      svc.create({ campaignId: other, target: char, body: 'c' })
      expect(svc.removeAllForCampaign(camp)).toBe(2)
      expect(svc.listForCampaign(other)).toHaveLength(1)
    })

    it('removeAllForTarget scopes to one entity', () => {
      svc.create({ campaignId: camp, target: char, body: 'a' })
      svc.create({ campaignId: camp, target: char, body: 'b' })
      svc.create({ campaignId: camp, target: place, body: 'c' })
      expect(svc.removeAllForTarget(camp, char)).toBe(2)
      expect(svc.forTarget(camp, place)).toHaveLength(1)
    })
  })

  describe('not found surfaces', () => {
    it('get throws NotFound', () => {
      // @ts-expect-error bypass brand
      expect(() => svc.get('not_NOPE000000' as never)).toThrow(NotFoundError)
    })

    it('tryGet returns null', () => {
      // @ts-expect-error bypass brand
      expect(svc.tryGet('not_NOPE000000' as never)).toBe(null)
    })
  })
})
