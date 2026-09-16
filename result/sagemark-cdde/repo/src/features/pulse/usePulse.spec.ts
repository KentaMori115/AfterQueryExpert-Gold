import { defineComponent } from 'vue'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { useCampaignStore } from '@features/campaigns/store'
import { useNoteStore } from '@features/notes/store'
import { useQuestStore } from '@features/quests/store'
import { useSessionStore } from '@features/sessions/store'

import { usePulse, type PulseSummary } from './usePulse'

function harness(campaignId: () => string | null) {
  const Harness = defineComponent({
    setup(_, { expose }) {
      const r = usePulse({
        campaignId: () => {
          const cid = campaignId()
          return cid ? (cid as never) : null
        },
      })
      expose({ pulse: r.pulse })
      return () => null
    },
  })
  return mount(Harness)
}

function api(wrapper: ReturnType<typeof harness>): { pulse: PulseSummary | null } {
  return wrapper.vm as unknown as { pulse: PulseSummary | null }
}

describe('usePulse', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    window.localStorage.clear()
  })

  it('returns null when no campaign id', () => {
    const w = harness(() => null)
    expect(api(w).pulse).toBeNull()
  })

  it('returns the campaign summary with empty beats when nothing is logged', () => {
    const camp = useCampaignStore().create({ name: 'F' })
    const w = harness(() => camp.id)
    const summary = api(w).pulse!
    expect(summary.campaignName).toBe('F')
    expect(summary.beats).toEqual([])
    expect(summary.freshness).toBe('cold')
  })

  it('includes open quests as beats', () => {
    const camp = useCampaignStore().create({ name: 'F' })
    useQuestStore().create({ campaignId: camp.id, title: 'Find the bell', status: 'accepted' })
    const w = harness(() => camp.id)
    const summary = api(w).pulse!
    expect(summary.beats.some((b) => b.kind === 'open-quest')).toBe(true)
  })

  it('marks freshness as fresh when a recent session exists', () => {
    const camp = useCampaignStore().create({ name: 'F' })
    useSessionStore().create({
      campaignId: camp.id,
      title: 'Last week',
      playedAt: new Date().toISOString(),
    })
    const w = harness(() => camp.id)
    expect(api(w).pulse!.freshness).toBe('fresh')
  })

  it('flags overdue notes at the top of the list', () => {
    const camp = useCampaignStore().create({ name: 'F' })
    // anchor remindAt well into the past so the overdue check is stable across
    // timezone shifts and DST. Using a fixed instant rather than Date.now to
    // avoid a flake that bit us right after the spring change.
    useNoteStore().create({
      campaignId: camp.id,
      target: { kind: 'campaign', id: camp.id },
      title: 'Player check in',
      body: 'soon',
      priority: 'high',
      remindAt: '2024-01-01T10:00:00Z',
    })
    const w = harness(() => camp.id)
    const summary = api(w).pulse!
    expect(summary.beats[0]!.kind).toBe('overdue-note')
  })
})
