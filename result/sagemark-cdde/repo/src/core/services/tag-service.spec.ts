import { beforeEach, describe, expect, it } from 'vitest'

import { asCampaignId } from '../ids/brand'
import { ConflictError, ValidationError } from '../lib/errors'
import { MemoryStore } from '../persistence/storage'

import { TagService } from './tag-service'

const camp = asCampaignId('camp_X')

function svc(): TagService {
  return new TagService(new MemoryStore())
}

describe('TagService.create', () => {
  it('creates a tag with a generated slug', () => {
    const s = svc()
    const tag = s.create({ campaignId: camp, name: 'Iron Banner' })
    expect(tag.slug).toBe('iron-banner')
    expect(tag.appliedTo).toEqual([])
    expect(s.list()).toHaveLength(1)
  })

  it('rejects duplicate slugs within the same campaign', () => {
    const s = svc()
    s.create({ campaignId: camp, name: 'Iron Banner' })
    expect(() => s.create({ campaignId: camp, name: 'iron banner' })).toThrow(ConflictError)
  })

  it('allows the same slug under a different campaign', () => {
    const s = svc()
    s.create({ campaignId: camp, name: 'Iron Banner' })
    const other = s.create({ campaignId: asCampaignId('camp_Y'), name: 'Iron Banner' })
    expect(other.slug).toBe('iron-banner')
  })

  it('rejects bad drafts with a ValidationError', () => {
    const s = svc()
    expect(() => s.create({ campaignId: camp, name: '   ' })).toThrow(ValidationError)
  })

  it('picks a default tone based on creation order', () => {
    const s = svc()
    const a = s.create({ campaignId: camp, name: 'One' })
    const b = s.create({ campaignId: camp, name: 'Two' })
    expect(a.tone).not.toBe(b.tone)
  })
})

describe('TagService.rename', () => {
  it('updates the slug when the new name maps to a different slug', () => {
    const s = svc()
    const t = s.create({ campaignId: camp, name: 'Iron Banner' })
    const renamed = s.rename(t.id, 'Iron Circle')
    expect(renamed.slug).toBe('iron-circle')
  })

  it('rejects renaming into an existing slug', () => {
    const s = svc()
    s.create({ campaignId: camp, name: 'Iron Banner' })
    const other = s.create({ campaignId: camp, name: 'Iron Circle' })
    expect(() => s.rename(other.id, 'Iron Banner')).toThrow(ConflictError)
  })

  it('allows a rename that keeps the same slug', () => {
    const s = svc()
    const t = s.create({ campaignId: camp, name: 'Iron Banner' })
    const renamed = s.rename(t.id, '  Iron Banner  ')
    expect(renamed.slug).toBe('iron-banner')
    expect(renamed.name).toBe('Iron Banner')
  })
})

describe('TagService.setTone and setDescription', () => {
  it('changes the tone', () => {
    const s = svc()
    const t = s.create({ campaignId: camp, name: 'Iron', tone: 'crimson' })
    const updated = s.setTone(t.id, 'sky')
    expect(updated.tone).toBe('sky')
  })

  it('rejects descriptions longer than 280 chars', () => {
    const s = svc()
    const t = s.create({ campaignId: camp, name: 'Iron' })
    expect(() => s.setDescription(t.id, 'x'.repeat(400))).toThrow(ValidationError)
  })

  it('updates description with trimmed value', () => {
    const s = svc()
    const t = s.create({ campaignId: camp, name: 'Iron' })
    const updated = s.setDescription(t.id, '  the second oath  ')
    expect(updated.description).toBe('the second oath')
  })
})

describe('TagService.attach and detach', () => {
  it('appends a target once and tolerates a repeat', () => {
    const s = svc()
    const t = s.create({ campaignId: camp, name: 'Iron' })
    const a = s.attach(t.id, 'character', 'char_1')
    expect(a.appliedTo).toEqual([{ kind: 'character', id: 'char_1' }])
    const again = s.attach(t.id, 'character', 'char_1')
    expect(again.appliedTo).toHaveLength(1)
  })

  it('detaches a specific kind and id', () => {
    const s = svc()
    const t = s.create({ campaignId: camp, name: 'Iron' })
    s.attach(t.id, 'character', 'char_1')
    s.attach(t.id, 'faction', 'fac_1')
    const detached = s.detach(t.id, 'character', 'char_1')
    expect(detached.appliedTo).toEqual([{ kind: 'faction', id: 'fac_1' }])
  })

  it('detachTarget unhooks every tag that touched the target', () => {
    const s = svc()
    const a = s.create({ campaignId: camp, name: 'Iron' })
    const b = s.create({ campaignId: camp, name: 'Bound' })
    s.attach(a.id, 'character', 'char_1')
    s.attach(b.id, 'character', 'char_1')
    const removed = s.detachTarget(camp, 'character', 'char_1')
    expect(removed).toBe(2)
    expect(s.forTarget(camp, 'character', 'char_1')).toEqual([])
  })
})

describe('TagService.forTarget', () => {
  it('returns the tags that touch the requested target only', () => {
    const s = svc()
    const a = s.create({ campaignId: camp, name: 'Iron' })
    const b = s.create({ campaignId: camp, name: 'Bound' })
    s.attach(a.id, 'character', 'char_1')
    s.attach(b.id, 'faction', 'fac_1')
    const hits = s.forTarget(camp, 'character', 'char_1')
    expect(hits.map((t) => t.slug)).toEqual(['iron'])
  })
})

describe('TagService.listForCampaign ordering', () => {
  it('puts more used tags first', () => {
    const s = svc()
    const heavy = s.create({ campaignId: camp, name: 'Heavy' })
    const light = s.create({ campaignId: camp, name: 'Light' })
    s.attach(heavy.id, 'character', 'a')
    s.attach(heavy.id, 'character', 'b')
    s.attach(light.id, 'character', 'a')
    const ordered = s.listForCampaign(camp).map((t) => t.slug)
    expect(ordered).toEqual(['heavy', 'light'])
  })
})

describe('TagService.delete', () => {
  let s: TagService
  beforeEach(() => {
    s = svc()
  })

  it('removes a tag by id', () => {
    const t = s.create({ campaignId: camp, name: 'Iron' })
    s.delete(t.id)
    expect(s.tryGet(t.id)).toBeNull()
  })

  it('throws when deleting a missing id', () => {
    expect(() => s.delete('tag_missing' as never)).toThrow(/not found/)
  })

  it('clears every tag belonging to a campaign', () => {
    s.create({ campaignId: camp, name: 'Iron' })
    s.create({ campaignId: camp, name: 'Bound' })
    expect(s.removeAllForCampaign(camp)).toBe(2)
    expect(s.listForCampaign(camp)).toEqual([])
  })
})
