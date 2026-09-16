import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { asCampaignId, asCharacterId, asLocationId } from '@core/ids'

import { useNoteStore } from './store'

describe('useNoteStore', () => {
  const camp = asCampaignId('camp_TESTABCDEF')
  const char = { kind: 'character' as const, id: asCharacterId('char_A') }
  const place = { kind: 'location' as const, id: asLocationId('loc_X') }

  beforeEach(() => {
    setActivePinia(createPinia())
    window.localStorage.clear()
  })

  it('starts empty', () => {
    expect(useNoteStore().all).toEqual([])
  })

  it('forTarget partitions by target kind plus id', () => {
    const store = useNoteStore()
    store.create({ campaignId: camp, target: char, body: 'a' })
    store.create({ campaignId: camp, target: place, body: 'b' })
    expect(store.forTarget(camp, char)).toHaveLength(1)
    expect(store.forTarget(camp, place)).toHaveLength(1)
  })

  it('pinnedFor only returns open pinned notes', () => {
    const store = useNoteStore()
    const pin = store.create({ campaignId: camp, target: char, body: 'a', pinned: true })
    const resolved = store.create({ campaignId: camp, target: char, body: 'b', pinned: true })
    store.resolve(resolved.id)
    expect(store.pinnedFor(camp).map((n) => n.id)).toEqual([pin.id])
  })

  it('overdueFor uses the supplied asOf for the cutoff', () => {
    const store = useNoteStore()
    store.create({
      campaignId: camp,
      target: char,
      body: 'a',
      remindAt: '2026-01-05T10:00:00Z',
    })
    store.create({
      campaignId: camp,
      target: char,
      body: 'b',
      remindAt: '2026-06-05T10:00:00Z',
    })
    const overdue = store.overdueFor(camp, new Date('2026-02-01T00:00:00Z'))
    expect(overdue).toHaveLength(1)
  })

  it('listedFor sorts pinned and priority first', () => {
    const store = useNoteStore()
    store.create({ campaignId: camp, target: char, body: 'low normal' })
    store.create({ campaignId: camp, target: char, body: 'high pinned', pinned: true, priority: 'high' })
    store.create({ campaignId: camp, target: char, body: 'critical', priority: 'critical' })
    const order = store.listedFor(camp).map((n) => n.body.split(' ')[0])
    expect(order[0]).toBe('high')
    expect(order[1]).toBe('critical')
  })

  it('setPriority changes priority', () => {
    const store = useNoteStore()
    const n = store.create({ campaignId: camp, target: char, body: 'a' })
    store.setPriority(n.id, 'critical')
    expect(store.byId(n.id)?.priority).toBe('critical')
  })

  it('setPinned toggles pinned state', () => {
    const store = useNoteStore()
    const n = store.create({ campaignId: camp, target: char, body: 'a' })
    store.setPinned(n.id, true)
    expect(store.byId(n.id)?.pinned).toBe(true)
  })

  it('resolve and reopen flip resolvedAt', () => {
    const store = useNoteStore()
    const n = store.create({ campaignId: camp, target: char, body: 'a' })
    store.resolve(n.id)
    expect(store.byId(n.id)?.resolvedAt).not.toBeNull()
    store.reopen(n.id)
    expect(store.byId(n.id)?.resolvedAt).toBe(null)
  })

  it('removeAllForTarget targets one entity only', () => {
    const store = useNoteStore()
    store.create({ campaignId: camp, target: char, body: 'a' })
    store.create({ campaignId: camp, target: char, body: 'b' })
    store.create({ campaignId: camp, target: place, body: 'c' })
    expect(store.removeAllForTarget(camp, char)).toBe(2)
    expect(store.forTarget(camp, place)).toHaveLength(1)
  })
})
