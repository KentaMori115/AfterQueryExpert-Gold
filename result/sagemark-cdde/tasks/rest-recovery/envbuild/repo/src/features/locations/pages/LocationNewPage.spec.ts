import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'

import LocationNewPage from './LocationNewPage.vue'
import { useCampaignStore } from '@features/campaigns/store'
import { useLocationStore } from '../store'

function makeRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { template: '<div />' } },
      { path: '/campaigns', component: { template: '<div />' } },
      { path: '/campaigns/:campaignId', component: { template: '<div />' } },
      { path: '/campaigns/:campaignId/locations', component: { template: '<div />' } },
      { path: '/campaigns/:campaignId/locations/new', component: LocationNewPage },
      { path: '/campaigns/:campaignId/locations/:id', component: { template: '<div />' } },
    ],
  })
}

describe('LocationNewPage', () => {
  let router: Router

  beforeEach(async () => {
    setActivePinia(createPinia())
    window.localStorage.clear()
    router = makeRouter()
  })

  it('shows not-found when campaign is missing', async () => {
    await router.push('/campaigns/camp_MISSING/locations/new')
    await router.isReady()
    const w = mount(LocationNewPage, { global: { plugins: [router] } })
    expect(w.text()).toContain('Campaign not found')
  })

  it('creates and routes to the detail', async () => {
    const cStore = useCampaignStore()
    const lStore = useLocationStore()
    const c = cStore.create({ name: 'X' })
    await router.push(`/campaigns/${c.id}/locations/new`)
    await router.isReady()
    const w = mount(LocationNewPage, { global: { plugins: [router] } })
    await w.get('#location-name').setValue('Frostfell')
    await w.find('form').trigger('submit.prevent')
    await flushPromises()
    expect(lStore.forCampaign(c.id)).toHaveLength(1)
    const l = lStore.forCampaign(c.id)[0]!
    expect(router.currentRoute.value.path).toBe(`/campaigns/${c.id}/locations/${l.id}`)
  })

  it('cancel returns to list', async () => {
    const cStore = useCampaignStore()
    const c = cStore.create({ name: 'X' })
    await router.push(`/campaigns/${c.id}/locations/new`)
    await router.isReady()
    const w = mount(LocationNewPage, { global: { plugins: [router] } })
    const back = w.findAll('button').find((b) => b.text() === 'Back')
    await back!.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe(`/campaigns/${c.id}/locations`)
  })
})
