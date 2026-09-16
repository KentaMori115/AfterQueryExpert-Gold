import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { asCampaignId, asFactionId } from '@core/ids'

import InfluenceTrendPanel from './InfluenceTrendPanel.vue'
import { useInfluenceStore } from '../store'

const campaignId = asCampaignId('camp_TESTABCDEF')
const factionId = asFactionId('fac_A0000000')

describe('InfluenceTrendPanel', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    window.localStorage.clear()
  })

  it('shows empty state when no snapshots', () => {
    const w = mount(InfluenceTrendPanel, {
      props: { campaignId, factionId, currentInfluence: 30 },
    })
    expect(w.text()).toContain('No snapshots yet')
  })

  it('captures a snapshot using the current influence', async () => {
    const store = useInfluenceStore()
    const w = mount(InfluenceTrendPanel, {
      props: { campaignId, factionId, currentInfluence: 42 },
    })
    await w.find('form').trigger('submit.prevent')
    await flushPromises()
    expect(store.forFaction(factionId)).toHaveLength(1)
    expect(store.forFaction(factionId)[0]?.influence).toBe(42)
  })

  it('renders the sparkline once at least one snapshot exists', async () => {
    const store = useInfluenceStore()
    store.record({ campaignId, factionId, influence: 20 })
    store.record({ campaignId, factionId, influence: 60 })
    const w = mount(InfluenceTrendPanel, {
      props: { campaignId, factionId, currentInfluence: 60 },
    })
    expect(w.find('svg').exists()).toBe(true)
    expect(w.findAll('circle')).toHaveLength(2)
  })

  it('reports the trend label', async () => {
    const store = useInfluenceStore()
    store.record({ campaignId, factionId, influence: 20 })
    store.record({ campaignId, factionId, influence: 60 })
    const w = mount(InfluenceTrendPanel, {
      props: { campaignId, factionId, currentInfluence: 60 },
    })
    expect(w.text()).toContain('rising')
  })

  it('removes a snapshot with confirm', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const store = useInfluenceStore()
    const a = store.record({ campaignId, factionId, influence: 20 })
    const w = mount(InfluenceTrendPanel, {
      props: { campaignId, factionId, currentInfluence: 20 },
    })
    const details = w.find('details')
    details.element.open = true
    await details.trigger('toggle')
    const remove = w.findAll('button').find((b) => b.text() === 'remove')
    await remove!.trigger('click')
    expect(store.forFaction(factionId).find((s) => s.id === a.id)).toBeUndefined()
    confirmSpy.mockRestore()
  })
})
