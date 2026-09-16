import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'

import TimelinePage from './pages/TimelinePage.vue'
import { useCampaignStore } from '@features/campaigns/store'
import { useTimelineStore } from './store'

function makeRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { template: '<div />' } },
      { path: '/campaigns', component: { template: '<div />' } },
      { path: '/campaigns/:campaignId', component: { template: '<div />' } },
      { path: '/campaigns/:campaignId/timeline', component: TimelinePage },
    ],
  })
}

describe('TimelinePage', () => {
  let router: Router

  beforeEach(async () => {
    setActivePinia(createPinia())
    window.localStorage.clear()
    router = makeRouter()
  })

  it('not-found when campaign missing', async () => {
    await router.push('/campaigns/camp_MISSING/timeline')
    await router.isReady()
    const w = mount(TimelinePage, { global: { plugins: [router] } })
    expect(w.text()).toContain('Campaign not found')
  })

  it('empty state when no events', async () => {
    const c = useCampaignStore().create({ name: 'X' })
    await router.push(`/campaigns/${c.id}/timeline`)
    await router.isReady()
    const w = mount(TimelinePage, { global: { plugins: [router] } })
    expect(w.text()).toContain('No events recorded')
  })

  it('adds an event', async () => {
    const c = useCampaignStore().create({ name: 'X' })
    const tStore = useTimelineStore()
    await router.push(`/campaigns/${c.id}/timeline`)
    await router.isReady()
    const w = mount(TimelinePage, { global: { plugins: [router] } })
    await w.get('#event-title').setValue('Pact of Thorns')
    await w.find('form').trigger('submit.prevent')
    await flushPromises()
    expect(tStore.forCampaign(c.id)).toHaveLength(1)
    expect(w.text()).toContain('Pact of Thorns')
  })

  it('toggles reveal', async () => {
    const c = useCampaignStore().create({ name: 'X' })
    const tStore = useTimelineStore()
    const e = tStore.create({ campaignId: c.id, title: 'X', date: { year: 1 } })
    await router.push(`/campaigns/${c.id}/timeline`)
    await router.isReady()
    const w = mount(TimelinePage, { global: { plugins: [router] } })
    const btn = w.findAll('button').find((b) => b.text() === 'reveal')
    await btn!.trigger('click')
    expect(tStore.byId(e.id)?.revealed).toBe(true)
  })

  it('delete with confirm removes', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const c = useCampaignStore().create({ name: 'X' })
    const tStore = useTimelineStore()
    const e = tStore.create({ campaignId: c.id, title: 'X', date: { year: 1 } })
    await router.push(`/campaigns/${c.id}/timeline`)
    await router.isReady()
    const w = mount(TimelinePage, { global: { plugins: [router] } })
    const del = w.findAll('button').find((b) => b.text() === 'delete')
    await del!.trigger('click')
    expect(tStore.byId(e.id)).toBe(null)
    confirmSpy.mockRestore()
  })
})
