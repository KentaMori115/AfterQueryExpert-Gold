import { beforeEach, describe, expect, it } from 'vitest'

import { asCampaignId, asCharacterId } from '../ids/brand'
import { NotFoundError, ValidationError } from '../lib/errors'
import { MemoryStore } from '../persistence/storage'

import { DowntimeService } from './downtime-service'

const camp = asCampaignId('camp_X')
const charA = asCharacterId('char_A')
const charB = asCharacterId('char_B')

function svc(): DowntimeService {
  return new DowntimeService(new MemoryStore())
}

describe('DowntimeService.create', () => {
  it('creates an activity with the planned outcome', () => {
    const s = svc()
    const a = s.create({
      campaignId: camp,
      characterId: charA,
      kind: 'crafting',
      weeks: 4,
    })
    expect(a.outcome).toBe('planned')
    expect(a.weeks).toBe(4)
    expect(s.list()).toHaveLength(1)
  })

  it('defaults weeks to one when omitted', () => {
    const s = svc()
    const a = s.create({ campaignId: camp, characterId: charA, kind: 'training' })
    expect(a.weeks).toBe(1)
  })

  it('rejects bad drafts', () => {
    const s = svc()
    expect(() =>
      s.create({
        campaignId: camp,
        characterId: charA,
        kind: 'haggling' as never,
      }),
    ).toThrow(ValidationError)
  })
})

describe('DowntimeService.setOutcome', () => {
  let s: DowntimeService
  beforeEach(() => {
    s = svc()
  })

  it('moves between outcomes', () => {
    const a = s.create({ campaignId: camp, characterId: charA, kind: 'training' })
    const underway = s.setOutcome(a.id, 'underway')
    expect(underway.outcome).toBe('underway')
    const paid = s.setOutcome(a.id, 'paid off')
    expect(paid.outcome).toBe('paid off')
  })

  it('is a no op when the outcome already matches', () => {
    const a = s.create({ campaignId: camp, characterId: charA, kind: 'training' })
    const same = s.setOutcome(a.id, 'planned')
    expect(same).toEqual(a)
  })
})

describe('DowntimeService.setWeeks and setDescription', () => {
  it('clamps and floors weeks', () => {
    const s = svc()
    const a = s.create({ campaignId: camp, characterId: charA, kind: 'training' })
    const next = s.setWeeks(a.id, 4.7)
    expect(next.weeks).toBe(4)
  })

  it('rejects weeks above 520', () => {
    const s = svc()
    const a = s.create({ campaignId: camp, characterId: charA, kind: 'training' })
    expect(() => s.setWeeks(a.id, 600)).toThrow(ValidationError)
  })

  it('rejects descriptions longer than 280 chars', () => {
    const s = svc()
    const a = s.create({ campaignId: camp, characterId: charA, kind: 'training' })
    expect(() => s.setDescription(a.id, 'x'.repeat(500))).toThrow(ValidationError)
  })
})

describe('DowntimeService.listForCharacter', () => {
  it('returns only this character is activities', () => {
    const s = svc()
    s.create({ campaignId: camp, characterId: charA, kind: 'training' })
    s.create({ campaignId: camp, characterId: charB, kind: 'research' })
    expect(s.listForCharacter(camp, charA)).toHaveLength(1)
    expect(s.listForCharacter(camp, charB)).toHaveLength(1)
  })

  it('orders so underway comes before planned and resolved', () => {
    const s = svc()
    const planned = s.create({ campaignId: camp, characterId: charA, kind: 'training' })
    const underway = s.create({ campaignId: camp, characterId: charA, kind: 'crafting' })
    s.setOutcome(underway.id, 'underway')
    s.setOutcome(planned.id, 'planned')
    expect(s.listForCharacter(camp, charA).map((a) => a.kind)).toEqual(['crafting', 'training'])
  })
})

describe('DowntimeService.delete', () => {
  it('removes by id', () => {
    const s = svc()
    const a = s.create({ campaignId: camp, characterId: charA, kind: 'training' })
    s.delete(a.id)
    expect(s.tryGet(a.id)).toBeNull()
  })

  it('throws when the id is missing', () => {
    const s = svc()
    expect(() => s.delete('dt_missing')).toThrow(NotFoundError)
  })

  it('removeAllForCharacter clears just one character', () => {
    const s = svc()
    s.create({ campaignId: camp, characterId: charA, kind: 'training' })
    s.create({ campaignId: camp, characterId: charA, kind: 'crafting' })
    s.create({ campaignId: camp, characterId: charB, kind: 'research' })
    const removed = s.removeAllForCharacter(camp, charA)
    expect(removed).toBe(2)
    expect(s.listForCharacter(camp, charA)).toEqual([])
    expect(s.listForCharacter(camp, charB)).toHaveLength(1)
  })
})
