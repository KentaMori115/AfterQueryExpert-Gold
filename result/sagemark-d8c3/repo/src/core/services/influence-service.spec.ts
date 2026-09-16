import { beforeEach, describe, expect, it } from 'vitest'

import { asCampaignId, asFactionId } from '../ids'
import { NotFoundError, ValidationError } from '../lib/errors'
import { MemoryStore } from '../persistence/storage'

import { InfluenceService } from './influence-service'

describe('InfluenceService', () => {
  const camp = asCampaignId('camp_TESTABCDEF')
  const facA = asFactionId('fac_A0000000')
  const facB = asFactionId('fac_B0000000')

  let store: MemoryStore
  let svc: InfluenceService

  beforeEach(() => {
    store = new MemoryStore()
    svc = new InfluenceService(store)
  })

  it('records a snapshot with current timestamp', () => {
    const s = svc.record({ campaignId: camp, factionId: facA, influence: 50 })
    expect(s.id).toMatch(/^inf_/)
    expect(s.influence).toBe(50)
  })

  it('rejects out of range influence', () => {
    expect(() => svc.record({ campaignId: camp, factionId: facA, influence: 200 })).toThrow(
      ValidationError,
    )
  })

  it('listForFaction returns chronological order', async () => {
    svc.record({ campaignId: camp, factionId: facA, influence: 30 })
    await new Promise((r) => setTimeout(r, 5))
    svc.record({ campaignId: camp, factionId: facA, influence: 50 })
    const list = svc.listForFaction(facA)
    expect(list[0]?.influence).toBe(30)
    expect(list[1]?.influence).toBe(50)
  })

  it('listForCampaign returns everything for that campaign', () => {
    svc.record({ campaignId: camp, factionId: facA, influence: 30 })
    svc.record({ campaignId: camp, factionId: facB, influence: 60 })
    expect(svc.listForCampaign(camp)).toHaveLength(2)
  })

  it('get throws on missing', () => {
    expect(() => svc.get('inf_NOPE')).toThrow(NotFoundError)
  })

  it('removeAllForFaction clears only that faction', () => {
    svc.record({ campaignId: camp, factionId: facA, influence: 50 })
    svc.record({ campaignId: camp, factionId: facB, influence: 50 })
    expect(svc.removeAllForFaction(facA)).toBe(1)
    expect(svc.listForFaction(facB)).toHaveLength(1)
  })
})
