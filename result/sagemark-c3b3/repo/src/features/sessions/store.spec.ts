import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { asCampaignId, asCharacterId } from '@core/ids'

import { useSessionStore } from './store'

describe('useSessionStore', () => {
  const camp = asCampaignId('camp_TEST123456')

  beforeEach(() => {
    setActivePinia(createPinia())
    window.localStorage.clear()
  })

  it('starts empty', () => {
    const store = useSessionStore()
    expect(store.all).toEqual([])
  })

  it('creates a session', () => {
    const store = useSessionStore()
    const s = store.create({ campaignId: camp, title: 'Opener', playedAt: '2025-04-01T20:00:00Z' })
    expect(store.byId(s.id)?.number).toBe(1)
  })

  it('chronologicalFor returns ascending by date', () => {
    const store = useSessionStore()
    store.create({ campaignId: camp, title: 'b', playedAt: '2025-05-01T20:00:00Z' })
    store.create({ campaignId: camp, title: 'a', playedAt: '2025-04-01T20:00:00Z' })
    const order = store.chronologicalFor(camp).map((s) => s.title)
    expect(order).toEqual(['a', 'b'])
  })

  it('setAttendance toggles', () => {
    const store = useSessionStore()
    const s = store.create({ campaignId: camp, title: 'X', playedAt: '2025-04-01T20:00:00Z' })
    const ch = asCharacterId('char_PC1')
    store.setAttendance(s.id, ch, true)
    expect(store.byId(s.id)?.attendees).toContain(ch)
    store.setAttendance(s.id, ch, false)
    expect(store.byId(s.id)?.attendees).not.toContain(ch)
  })

  it('updateLog replaces the log', () => {
    const store = useSessionStore()
    const s = store.create({ campaignId: camp, title: 'X', playedAt: '2025-04-01T20:00:00Z' })
    store.updateLog(s.id, 'They burned the inn down.')
    expect(store.byId(s.id)?.log).toContain('burned')
  })

  it('latestFor returns descending by date', () => {
    const store = useSessionStore()
    store.create({ campaignId: camp, title: 'oldest', playedAt: '2025-01-01T20:00:00Z' })
    store.create({ campaignId: camp, title: 'newest', playedAt: '2025-06-01T20:00:00Z' })
    const latest = store.latestFor(camp, 1)
    expect(latest[0]?.title).toBe('newest')
  })

  it('remove drops the session', () => {
    const store = useSessionStore()
    const s = store.create({ campaignId: camp, title: 'X', playedAt: '2025-04-01T20:00:00Z' })
    store.remove(s.id)
    expect(store.byId(s.id)).toBe(null)
  })
})
