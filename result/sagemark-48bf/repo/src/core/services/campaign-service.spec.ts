import { beforeEach, describe, expect, it, vi } from 'vitest'

import { NotFoundError, ValidationError } from '../lib/errors'
import { MemoryStore } from '../persistence/storage'

import { CampaignService } from './campaign-service'

describe('CampaignService', () => {
  let store: MemoryStore
  let svc: CampaignService

  beforeEach(() => {
    store = new MemoryStore()
    svc = new CampaignService(store)
  })

  describe('create', () => {
    it('builds a campaign with sensible defaults', () => {
      const c = svc.create({ name: 'The Frozen Gate' })
      expect(c.id).toMatch(/^camp_/)
      expect(c.name).toBe('The Frozen Gate')
      expect(c.tagline).toBe('')
      expect(c.system).toBe('custom')
      expect(c.status).toBe('planning')
      expect(c.sessionCount).toBe(0)
      expect(c.startedAt).toBe(null)
      expect(c.lastPlayedAt).toBe(null)
      expect(c.createdAt).toBe(c.updatedAt)
    })

    it('respects supplied system and status', () => {
      const c = svc.create({ name: 'X', system: 'dnd5e', status: 'active' })
      expect(c.system).toBe('dnd5e')
      expect(c.status).toBe('active')
    })

    it('rejects invalid input via ValidationError', () => {
      expect(() => svc.create({ name: '' })).toThrow(ValidationError)
      try {
        svc.create({ name: '' })
      } catch (e) {
        expect(e).toBeInstanceOf(ValidationError)
        if (e instanceof ValidationError) {
          expect(e.issues.name).toMatch(/required/)
        }
      }
    })

    it('persists so a fresh service instance sees it', () => {
      const c = svc.create({ name: 'Persistent' })
      const fresh = new CampaignService(store)
      expect(fresh.get(c.id).name).toBe('Persistent')
    })
  })

  describe('list / get / tryGet', () => {
    it('lists in arbitrary order', () => {
      svc.create({ name: 'A' })
      svc.create({ name: 'B' })
      expect(svc.list()).toHaveLength(2)
    })

    it('throws NotFoundError for an unknown id', () => {
      // a syntactically valid but unknown id
      // @ts-expect-error - bypass brand for the test
      expect(() => svc.get('camp_ZZZZZZZZZZ' as never)).toThrow(NotFoundError)
    })

    it('tryGet returns null for an unknown id', () => {
      // @ts-expect-error - bypass brand for the test
      expect(svc.tryGet('camp_ZZZZZZZZZZ' as never)).toBe(null)
    })
  })

  describe('update', () => {
    it('changes editable fields and bumps updatedAt', async () => {
      const c = svc.create({ name: 'Old' })
      const originalUpdatedAt = c.updatedAt
      // Ensure the clock advances at least a millisecond
      await new Promise((r) => setTimeout(r, 5))
      const updated = svc.update(c.id, { name: 'New', tagline: 'a tag', system: 'pf2e' })
      expect(updated.name).toBe('New')
      expect(updated.tagline).toBe('a tag')
      expect(updated.system).toBe('pf2e')
      expect(updated.createdAt).toBe(c.createdAt)
      expect(updated.updatedAt >= originalUpdatedAt).toBe(true)
    })

    it('throws when the campaign does not exist', () => {
      // @ts-expect-error - bypass brand
      expect(() => svc.update('camp_MISSING1234' as never, { name: 'x' })).toThrow(NotFoundError)
    })
  })

  describe('setStatus', () => {
    it('moves the campaign to the requested status', () => {
      const c = svc.create({ name: 'X' })
      const moved = svc.setStatus(c.id, 'finished')
      expect(moved.status).toBe('finished')
    })
  })

  describe('recordSessionPlayed', () => {
    it('increments the count and sets last played', () => {
      const c = svc.create({ name: 'X' })
      const after = svc.recordSessionPlayed(c.id, '2025-04-12T22:30:00Z')
      expect(after.sessionCount).toBe(1)
      expect(after.lastPlayedAt).not.toBeNull()
      expect(after.startedAt).not.toBeNull()
      expect(after.status).toBe('active')
    })

    it('does not regress a status that is past planning', () => {
      const c = svc.create({ name: 'X', status: 'finished' })
      const after = svc.recordSessionPlayed(c.id)
      expect(after.status).toBe('finished')
    })

    it('keeps the original startedAt across more sessions', () => {
      const c = svc.create({ name: 'X' })
      const a = svc.recordSessionPlayed(c.id, '2025-04-12T22:30:00Z')
      const b = svc.recordSessionPlayed(c.id, '2025-05-12T22:30:00Z')
      expect(b.startedAt).toBe(a.startedAt)
      expect(b.sessionCount).toBe(2)
    })
  })

  describe('delete', () => {
    it('removes the campaign', () => {
      const c = svc.create({ name: 'X' })
      svc.delete(c.id)
      expect(svc.tryGet(c.id)).toBe(null)
    })

    it('throws on delete of an unknown id', () => {
      // @ts-expect-error - bypass brand
      expect(() => svc.delete('camp_NOPE0000000' as never)).toThrow(NotFoundError)
    })
  })

  it('reports count', () => {
    expect(svc.count()).toBe(0)
    svc.create({ name: 'A' })
    svc.create({ name: 'B' })
    expect(svc.count()).toBe(2)
  })

  it('does not leak between separately constructed stores', () => {
    const otherStore = new MemoryStore()
    const otherSvc = new CampaignService(otherStore)
    svc.create({ name: 'mine' })
    expect(otherSvc.count()).toBe(0)
  })
})
