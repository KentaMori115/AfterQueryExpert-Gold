import { beforeEach, describe, expect, it } from 'vitest'

import { asCampaignId, asCharacterId, asFactionId } from '../ids'
import { NotFoundError, ValidationError } from '../lib/errors'
import { MemoryStore } from '../persistence/storage'

import { RelationshipService } from './relationship-service'

describe('RelationshipService', () => {
  const camp = asCampaignId('camp_TEST123456')
  const other = asCampaignId('camp_OTHER12345')
  const cA = asCharacterId('char_A0000000')
  const cB = asCharacterId('char_B0000000')
  const cC = asCharacterId('char_C0000000')
  const fX = asFactionId('fac_X0000000')

  let store: MemoryStore
  let svc: RelationshipService

  beforeEach(() => {
    store = new MemoryStore()
    svc = new RelationshipService(store)
  })

  describe('create', () => {
    it('builds with defaults', () => {
      const r = svc.create({
        campaignId: camp,
        from: { kind: 'character', id: cA },
        to: { kind: 'character', id: cB },
      })
      expect(r.id).toMatch(/^rel_/)
      expect(r.kind).toBe('unknown')
      expect(r.intensity).toBe(3)
      expect(r.reciprocal).toBe(true)
    })

    it('honours kind + intensity', () => {
      const r = svc.create({
        campaignId: camp,
        from: { kind: 'character', id: cA },
        to: { kind: 'faction', id: fX },
        kind: 'enemy',
        intensity: 5,
      })
      expect(r.kind).toBe('enemy')
      expect(r.intensity).toBe(5)
    })

    it('rejects a self-link', () => {
      expect(() =>
        svc.create({
          campaignId: camp,
          from: { kind: 'character', id: cA },
          to: { kind: 'character', id: cA },
        }),
      ).toThrow(ValidationError)
    })
  })

  describe('forNode / neighborsOf', () => {
    it('returns the edges that involve a node', () => {
      svc.create({
        campaignId: camp,
        from: { kind: 'character', id: cA },
        to: { kind: 'character', id: cB },
      })
      svc.create({
        campaignId: camp,
        from: { kind: 'character', id: cA },
        to: { kind: 'faction', id: fX },
      })
      svc.create({
        campaignId: camp,
        from: { kind: 'character', id: cB },
        to: { kind: 'character', id: cC },
      })
      const edges = svc.forNode(camp, { kind: 'character', id: cA })
      expect(edges).toHaveLength(2)
    })

    it('returns the unique neighbours of a node', () => {
      svc.create({
        campaignId: camp,
        from: { kind: 'character', id: cA },
        to: { kind: 'character', id: cB },
      })
      svc.create({
        campaignId: camp,
        from: { kind: 'character', id: cA },
        to: { kind: 'character', id: cB },
      })
      const ns = svc.neighborsOf(camp, { kind: 'character', id: cA })
      expect(ns).toHaveLength(1)
      expect(ns[0]?.kind).toBe('character')
    })
  })

  describe('get / tryGet / update / delete', () => {
    it('get throws', () => {
      // @ts-expect-error
      expect(() => svc.get('rel_NOPE000000' as never)).toThrow(NotFoundError)
    })

    it('tryGet returns null', () => {
      // @ts-expect-error
      expect(svc.tryGet('rel_NOPE000000' as never)).toBe(null)
    })

    it('update mutates', () => {
      const r = svc.create({
        campaignId: camp,
        from: { kind: 'character', id: cA },
        to: { kind: 'character', id: cB },
      })
      const u = svc.update(r.id, {
        campaignId: camp,
        from: { kind: 'character', id: cA },
        to: { kind: 'character', id: cB },
        kind: 'ally',
      })
      expect(u.kind).toBe('ally')
    })

    it('delete removes', () => {
      const r = svc.create({
        campaignId: camp,
        from: { kind: 'character', id: cA },
        to: { kind: 'character', id: cB },
      })
      svc.delete(r.id)
      expect(svc.tryGet(r.id)).toBe(null)
    })
  })

  describe('removeAllForCampaign / removeAllInvolving', () => {
    it('removeAllForCampaign drops scoped', () => {
      svc.create({
        campaignId: camp,
        from: { kind: 'character', id: cA },
        to: { kind: 'character', id: cB },
      })
      svc.create({
        campaignId: other,
        from: { kind: 'character', id: cA },
        to: { kind: 'character', id: cC },
      })
      expect(svc.removeAllForCampaign(camp)).toBe(1)
      expect(svc.listForCampaign(other)).toHaveLength(1)
    })

    it('removeAllInvolving drops only those touching the node', () => {
      svc.create({
        campaignId: camp,
        from: { kind: 'character', id: cA },
        to: { kind: 'character', id: cB },
      })
      svc.create({
        campaignId: camp,
        from: { kind: 'character', id: cB },
        to: { kind: 'character', id: cC },
      })
      const removed = svc.removeAllInvolving(camp, { kind: 'character', id: cA })
      expect(removed).toBe(1)
      expect(svc.listForCampaign(camp)).toHaveLength(1)
    })
  })
})
