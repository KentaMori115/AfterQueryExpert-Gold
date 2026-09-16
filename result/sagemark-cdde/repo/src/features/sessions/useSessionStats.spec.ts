import { defineComponent } from 'vue'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { useCampaignStore } from '@features/campaigns/store'

import { useSessionStore } from './store'
import { type SessionStats, useSessionStats } from './useSessionStats'

function harness(campaignId: () => string | null) {
  const Harness = defineComponent({
    setup(_, { expose }) {
      const r = useSessionStats({
        campaignId: () => {
          const cid = campaignId()
          return cid ? (cid as never) : null
        },
      })
      expose({ stats: r.stats })
      return () => null
    },
  })
  return mount(Harness)
}

function api(wrapper: ReturnType<typeof harness>): { stats: SessionStats | null } {
  return wrapper.vm as unknown as { stats: SessionStats | null }
}

describe('useSessionStats', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    window.localStorage.clear()
  })

  it('returns null with no campaign', () => {
    expect(api(harness(() => null)).stats).toBeNull()
  })

  it('returns zero stats for no sessions', () => {
    const camp = useCampaignStore().create({ name: 'F' })
    expect(api(harness(() => camp.id)).stats!.total).toBe(0)
  })

  it('aggregates total and average minutes', () => {
    const camp = useCampaignStore().create({ name: 'F' })
    const sessions = useSessionStore()
    sessions.create({
      campaignId: camp.id,
      title: 'A',
      playedAt: new Date('2026-01-15').toISOString(),
      durationMinutes: 180,
    })
    sessions.create({
      campaignId: camp.id,
      title: 'B',
      playedAt: new Date('2026-02-15').toISOString(),
      durationMinutes: 220,
    })
    const stats = api(harness(() => camp.id)).stats!
    expect(stats.total).toBe(2)
    expect(stats.totalMinutes).toBe(400)
    expect(stats.averageMinutes).toBe(200)
    expect(stats.longest?.minutes).toBe(220)
    expect(stats.shortest?.minutes).toBe(180)
  })

  it('counts sessions by year-month and computes cadence', () => {
    const camp = useCampaignStore().create({ name: 'F' })
    const sessions = useSessionStore()
    sessions.create({
      campaignId: camp.id,
      title: 'A',
      playedAt: new Date('2026-01-01').toISOString(),
    })
    sessions.create({
      campaignId: camp.id,
      title: 'B',
      playedAt: new Date('2026-01-15').toISOString(),
    })
    sessions.create({
      campaignId: camp.id,
      title: 'C',
      playedAt: new Date('2026-02-01').toISOString(),
    })
    const stats = api(harness(() => camp.id)).stats!
    expect(stats.sessionsByMonth['2026-01']).toBe(2)
    expect(stats.sessionsByMonth['2026-02']).toBe(1)
    expect(stats.cadenceDays).not.toBeNull()
    expect(stats.cadenceDays!).toBeGreaterThan(0)
  })
})
