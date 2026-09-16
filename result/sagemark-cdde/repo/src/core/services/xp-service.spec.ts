import { beforeEach, describe, expect, it } from 'vitest'

import { asCampaignId, asCharacterId } from '../ids'
import { NotFoundError, ValidationError } from '../lib/errors'
import { MemoryStore } from '../persistence/storage'

import { XpService } from './xp-service'

describe('XpService', () => {
  const camp = asCampaignId('camp_TEST123456')
  const other = asCampaignId('camp_OTHER12345')
  const charA = asCharacterId('char_A0000000')
  const charB = asCharacterId('char_B0000000')

  let store: MemoryStore
  let svc: XpService

  beforeEach(() => {
    store = new MemoryStore()
    svc = new XpService(store)
  })

  it('records an award with default kind', () => {
    const e = svc.recordAward({ campaignId: camp, characterId: charA, amount: 100 })
    expect(e.kind).toBe('award')
    expect(e.amount).toBe(100)
  })

  it('records deduct and milestone with their respective kinds', () => {
    expect(svc.recordDeduct({ campaignId: camp, characterId: charA, amount: 50 }).kind).toBe('deduct')
    expect(svc.recordMilestone({ campaignId: camp, characterId: charA, amount: 500 }).kind).toBe('milestone')
  })

  it('rejects negative amount or fractional values', () => {
    expect(() => svc.recordAward({ campaignId: camp, characterId: charA, amount: -1 })).toThrow(ValidationError)
    expect(() => svc.recordAward({ campaignId: camp, characterId: charA, amount: 1.5 })).toThrow(ValidationError)
  })

  it('totals award and deduct entries across a character history', () => {
    svc.recordAward({ campaignId: camp, characterId: charA, amount: 200 })
    svc.recordDeduct({ campaignId: camp, characterId: charA, amount: 50 })
    svc.recordMilestone({ campaignId: camp, characterId: charA, amount: 100 })
    expect(svc.totalFor(charA)).toBe(250)
  })

  it('listForCharacter is sorted chronologically', () => {
    svc.recordAward({ campaignId: camp, characterId: charA, amount: 100 })
    svc.recordAward({ campaignId: camp, characterId: charA, amount: 200 })
    const list = svc.listForCharacter(charA)
    expect(list[0]?.recordedAt <= list[1]?.recordedAt).toBe(true)
  })

  it('listForCampaign returns just that campaign', () => {
    svc.recordAward({ campaignId: camp, characterId: charA, amount: 100 })
    svc.recordAward({ campaignId: other, characterId: charB, amount: 100 })
    expect(svc.listForCampaign(camp)).toHaveLength(1)
  })

  it('get throws NotFoundError on missing id', () => {
    expect(() => svc.get('xp_NOPE')).toThrow(NotFoundError)
  })

  it('removeAllForCharacter clears that character only', () => {
    svc.recordAward({ campaignId: camp, characterId: charA, amount: 100 })
    svc.recordAward({ campaignId: camp, characterId: charB, amount: 100 })
    expect(svc.removeAllForCharacter(charA)).toBe(1)
    expect(svc.listForCharacter(charB)).toHaveLength(1)
  })

  it('removeAllForCampaign clears that campaign only', () => {
    svc.recordAward({ campaignId: camp, characterId: charA, amount: 100 })
    svc.recordAward({ campaignId: other, characterId: charB, amount: 100 })
    expect(svc.removeAllForCampaign(camp)).toBe(1)
    expect(svc.listForCampaign(other)).toHaveLength(1)
  })
})
