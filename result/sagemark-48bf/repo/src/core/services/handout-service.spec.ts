import { beforeEach, describe, expect, it } from 'vitest'

import { asCampaignId } from '../ids'
import { NotFoundError, ValidationError } from '../lib/errors'
import { MemoryStore } from '../persistence/storage'

import { HandoutService } from './handout-service'

describe('HandoutService', () => {
  const camp = asCampaignId('camp_TESTABCDEF')
  const other = asCampaignId('camp_OTHER12345')

  let store: MemoryStore
  let svc: HandoutService

  beforeEach(() => {
    store = new MemoryStore()
    svc = new HandoutService(store)
  })

  it('creates with defaults including draft visibility', () => {
    const h = svc.create({ campaignId: camp, title: 'X' })
    expect(h.visibility).toBe('draft')
    expect(h.kind).toBe('note')
    expect(h.sharedAt).toBe(null)
  })

  it('rejects empty title', () => {
    expect(() => svc.create({ campaignId: camp, title: '   ' })).toThrow(ValidationError)
  })

  it('share sets the sharedAt timestamp', () => {
    const h = svc.create({ campaignId: camp, title: 'X' })
    const when = new Date('2026-04-10T10:00:00Z')
    const shared = svc.share(h.id, when)
    expect(shared.visibility).toBe('shared')
    expect(shared.sharedAt).not.toBeNull()
    expect(Date.parse(shared.sharedAt as string)).toBe(when.getTime())
  })

  it('share is idempotent', () => {
    const h = svc.create({ campaignId: camp, title: 'X', visibility: 'shared' })
    const again = svc.share(h.id)
    expect(again.sharedAt).toBe(h.sharedAt)
  })

  it('unshare clears sharedAt and flips to draft', () => {
    const h = svc.create({ campaignId: camp, title: 'X', visibility: 'shared' })
    const u = svc.unshare(h.id)
    expect(u.visibility).toBe('draft')
    expect(u.sharedAt).toBe(null)
  })

  it('archive sets archived visibility', () => {
    const h = svc.create({ campaignId: camp, title: 'X' })
    expect(svc.archive(h.id).visibility).toBe('archived')
  })

  it('addRecipient is case insensitive about duplicates', () => {
    const h = svc.create({ campaignId: camp, title: 'X' })
    const a = svc.addRecipient(h.id, 'Iris')
    const b = svc.addRecipient(a.id, 'iris')
    expect(b.recipients).toEqual(['Iris'])
  })

  it('removeRecipient drops by name case insensitively', () => {
    const h = svc.create({
      campaignId: camp,
      title: 'X',
      recipients: ['Iris', 'Brann'],
    })
    const next = svc.removeRecipient(h.id, 'IRIS')
    expect(next.recipients).toEqual(['Brann'])
  })

  it('forRecipient filters across campaigns', () => {
    svc.create({ campaignId: camp, title: 'A', recipients: ['Iris'] })
    svc.create({ campaignId: camp, title: 'B', recipients: ['Brann'] })
    svc.create({ campaignId: other, title: 'C', recipients: ['Iris'] })
    expect(svc.forRecipient(camp, 'iris')).toHaveLength(1)
  })

  it('byVisibility scopes correctly', () => {
    svc.create({ campaignId: camp, title: 'A', visibility: 'draft' })
    svc.create({ campaignId: camp, title: 'B', visibility: 'shared' })
    expect(svc.byVisibility(camp, 'shared')).toHaveLength(1)
  })

  it('get throws on missing', () => {
    expect(() => svc.get('hd_NOPE')).toThrow(NotFoundError)
  })

  it('removeAllForCampaign scopes correctly', () => {
    svc.create({ campaignId: camp, title: 'A' })
    svc.create({ campaignId: other, title: 'B' })
    expect(svc.removeAllForCampaign(camp)).toBe(1)
    expect(svc.listForCampaign(other)).toHaveLength(1)
  })
})
