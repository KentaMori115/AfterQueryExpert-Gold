import { beforeEach, describe, expect, it } from 'vitest'

import { asCampaignId } from '../ids'
import { NotFoundError, ValidationError } from '../lib/errors'
import { MemoryStore } from '../persistence/storage'

import { TimelineService } from './timeline-service'

describe('TimelineService', () => {
  const camp = asCampaignId('camp_TEST123456')
  const other = asCampaignId('camp_OTHER12345')

  let store: MemoryStore
  let svc: TimelineService

  beforeEach(() => {
    store = new MemoryStore()
    svc = new TimelineService(store)
  })

  describe('create', () => {
    it('builds with defaults', () => {
      const e = svc.create({ campaignId: camp, title: 'X', date: { year: 1234 } })
      expect(e.era).toBe('present')
      expect(e.significance).toBe('notable')
      expect(e.revealed).toBe(false)
    })

    it('rejects empty title', () => {
      expect(() => svc.create({ campaignId: camp, title: '  ', date: { year: 1 } })).toThrow(ValidationError)
    })
  })

  describe('chronological / revealed', () => {
    it('orders chronologically', () => {
      svc.create({ campaignId: camp, title: 'b', date: { year: 1500 } })
      svc.create({ campaignId: camp, title: 'a', date: { year: 1000 } })
      const ordered = svc.chronologicalFor(camp).map((e) => e.title)
      expect(ordered).toEqual(['a', 'b'])
    })

    it('filters by revealed', () => {
      svc.create({ campaignId: camp, title: 'a', date: { year: 1 }, revealed: true })
      svc.create({ campaignId: camp, title: 'b', date: { year: 2 } })
      expect(svc.revealedFor(camp)).toHaveLength(1)
    })
  })

  describe('setRevealed / update / delete', () => {
    it('setRevealed flips', () => {
      const e = svc.create({ campaignId: camp, title: 'X', date: { year: 1 } })
      expect(svc.setRevealed(e.id, true).revealed).toBe(true)
    })

    it('update changes year', () => {
      const e = svc.create({ campaignId: camp, title: 'X', date: { year: 1 } })
      const u = svc.update(e.id, { campaignId: camp, title: 'X', date: { year: 999 } })
      expect(u.date.year).toBe(999)
    })

    it('removeAllForCampaign scopes', () => {
      svc.create({ campaignId: camp, title: 'a', date: { year: 1 } })
      svc.create({ campaignId: other, title: 'b', date: { year: 1 } })
      expect(svc.removeAllForCampaign(camp)).toBe(1)
      expect(svc.listForCampaign(other)).toHaveLength(1)
    })

    it('get throws', () => {
      // @ts-expect-error
      expect(() => svc.get('tle_NOPE000000' as never)).toThrow(NotFoundError)
    })
  })
})
