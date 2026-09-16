import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'

import FactionNewPage from './FactionNewPage.vue'
import { useCampaignStore } from '@features/campaigns/store'
import { useFactionStore } from '../store'

function makeRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { template: '<div />' } },
      { path: '/campaigns', component: { template: '<div />' } },
      { path: '/campaigns/:campaignId', component: { template: '<div />' } },
      { path: '/campaigns/:campaignId/factions', component: { template: '<div />' } },
      { path: '/campaigns/:campaignId/factions/new', component: FactionNewPage },
      { path: '/campaigns/:campaignId/factions/:id', component: { template: '<div />' } },
    ],
  })
}

describe('FactionNewPage', () => {
  let router: Router

  beforeEach(async () => {
    setActivePinia(createPinia())
    window.localStorage.clear()
    router = makeRouter()
  })

  it('shows not-found when campaign is missing', async () => {
    await router.push('/campaigns/camp_MISSING/factions/new')
    await router.isReady()
    const w = mount(FactionNewPage, { global: { plugins: [router] } })
    expect(w.text()).toContain('Campaign not found')
  })

  it('creates a faction and routes to its detail', async () => {
    const cStore = useCampaignStore()
    const fStore = useFactionStore()
    const c = cStore.create({ name: 'X' })
    await router.push(`/campaigns/${c.id}/factions/new`)
    await router.isReady()
    const w = mount(FactionNewPage, { global: { plugins: [router] } })
    await w.get('#faction-name').setValue('Iron Hand')
    await w.find('form').trigger('submit.prevent')
    await flushPromises()
    expect(fStore.forCampaign(c.id)).toHaveLength(1)
    const f = fStore.forCampaign(c.id)[0]!
    expect(router.currentRoute.value.path).toBe(`/campaigns/${c.id}/factions/${f.id}`)
  })

  it('cancel routes back to faction list', async () => {
    const cStore = useCampaignStore()
    const c = cStore.create({ name: 'X' })
    await router.push(`/campaigns/${c.id}/factions/new`)
    await router.isReady()
    const w = mount(FactionNewPage, { global: { plugins: [router] } })
    const back = w.findAll('button').find((b) => b.text() === 'Back')
    await back!.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe(`/campaigns/${c.id}/factions`)
  })
})
