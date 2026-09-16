import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'

import ArcNewPage from './ArcNewPage.vue'
import { useCampaignStore } from '@features/campaigns/store'
import { useArcStore } from '../store'

function makeRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { template: '<div />' } },
      { path: '/campaigns', component: { template: '<div />' } },
      { path: '/campaigns/:campaignId', component: { template: '<div />' } },
      { path: '/campaigns/:campaignId/arcs', component: { template: '<div />' } },
      { path: '/campaigns/:campaignId/arcs/new', component: ArcNewPage },
      { path: '/campaigns/:campaignId/arcs/:id', component: { template: '<div />' } },
    ],
  })
}

describe('ArcNewPage', () => {
  let router: Router

  beforeEach(async () => {
    setActivePinia(createPinia())
    window.localStorage.clear()
    router = makeRouter()
  })

  it('not-found when campaign is missing', async () => {
    await router.push('/campaigns/camp_MISSING/arcs/new')
    await router.isReady()
    const w = mount(ArcNewPage, { global: { plugins: [router] } })
    expect(w.text()).toContain('Campaign not found')
  })

  it('creates an arc and routes to its detail', async () => {
    const cStore = useCampaignStore()
    const aStore = useArcStore()
    const c = cStore.create({ name: 'X' })
    await router.push(`/campaigns/${c.id}/arcs/new`)
    await router.isReady()
    const w = mount(ArcNewPage, { global: { plugins: [router] } })
    await w.get('#arc-title').setValue('Winter')
    await w.find('form').trigger('submit.prevent')
    await flushPromises()
    expect(aStore.forCampaign(c.id)).toHaveLength(1)
  })

  it('cancel returns to board', async () => {
    const cStore = useCampaignStore()
    const c = cStore.create({ name: 'X' })
    await router.push(`/campaigns/${c.id}/arcs/new`)
    await router.isReady()
    const w = mount(ArcNewPage, { global: { plugins: [router] } })
    const back = w.findAll('button').find((b) => b.text() === 'Back')
    await back!.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe(`/campaigns/${c.id}/arcs`)
  })
})
