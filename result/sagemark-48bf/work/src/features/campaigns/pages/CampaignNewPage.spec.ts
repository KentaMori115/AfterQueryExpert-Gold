import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'

import CampaignNewPage from './CampaignNewPage.vue'
import CampaignsListPage from './CampaignsListPage.vue'
import { useCampaignStore } from '../store'

function makeRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { template: '<div />' } },
      { path: '/campaigns', component: CampaignsListPage },
      { path: '/campaigns/new', component: CampaignNewPage },
    ],
  })
}

describe('CampaignNewPage', () => {
  let router: Router

  beforeEach(async () => {
    setActivePinia(createPinia())
    window.localStorage.clear()
    router = makeRouter()
    await router.push('/campaigns/new')
    await router.isReady()
  })

  it('shows the page header and form', () => {
    const w = mount(CampaignNewPage, { global: { plugins: [router] } })
    expect(w.text()).toContain('New campaign')
    expect(w.find('#campaign-name').exists()).toBe(true)
  })

  it('creates a campaign on submit and routes to /campaigns', async () => {
    const store = useCampaignStore()
    const w = mount(CampaignNewPage, { global: { plugins: [router] } })
    await w.get('#campaign-name').setValue('The Frozen Gate')
    await w.find('form').trigger('submit.prevent')
    await flushPromises()
    expect(store.all).toHaveLength(1)
    expect(store.all[0]?.name).toBe('The Frozen Gate')
    expect(router.currentRoute.value.path).toBe('/campaigns')
  })

  it('does not create a campaign when validation fails', async () => {
    const store = useCampaignStore()
    const w = mount(CampaignNewPage, { global: { plugins: [router] } })
    await w.find('form').trigger('submit.prevent')
    expect(store.all).toHaveLength(0)
    expect(router.currentRoute.value.path).toBe('/campaigns/new')
  })

  it('cancel routes back to /campaigns', async () => {
    const w = mount(CampaignNewPage, { global: { plugins: [router] } })
    const cancel = w.findAll('button').find((b) => b.text() === 'Back to list')
    await cancel!.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/campaigns')
  })
})
