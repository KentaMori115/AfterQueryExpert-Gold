import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'

import CampaignEditPage from './CampaignEditPage.vue'
import { useCampaignStore } from '../store'

function makeRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { template: '<div />' } },
      { path: '/campaigns', component: { template: '<div />' } },
      { path: '/campaigns/:id', component: { template: '<div />' } },
      { path: '/campaigns/:id/edit', component: CampaignEditPage },
    ],
  })
}

describe('CampaignEditPage', () => {
  let router: Router

  beforeEach(async () => {
    setActivePinia(createPinia())
    window.localStorage.clear()
    router = makeRouter()
  })

  it('shows not-found when the campaign id is wrong', async () => {
    await router.push('/campaigns/camp_MISSING000/edit')
    await router.isReady()
    const w = mount(CampaignEditPage, { global: { plugins: [router] } })
    expect(w.text()).toContain('Campaign not found')
  })

  it('seeds the form with current values', async () => {
    const store = useCampaignStore()
    const c = store.create({ name: 'Old', tagline: 'old tag', system: 'pf2e', status: 'paused' })
    await router.push(`/campaigns/${c.id}/edit`)
    await router.isReady()
    const w = mount(CampaignEditPage, { global: { plugins: [router] } })
    expect((w.get('#campaign-name').element as HTMLInputElement).value).toBe('Old')
    expect((w.get('#campaign-tagline').element as HTMLInputElement).value).toBe('old tag')
  })

  it('saves changes and routes back to the detail page', async () => {
    const store = useCampaignStore()
    const c = store.create({ name: 'Old' })
    await router.push(`/campaigns/${c.id}/edit`)
    await router.isReady()
    const w = mount(CampaignEditPage, { global: { plugins: [router] } })
    await w.get('#campaign-name').setValue('Renamed')
    await w.find('form').trigger('submit.prevent')
    await flushPromises()
    expect(store.all.find((x) => x.id === c.id)?.name).toBe('Renamed')
    expect(router.currentRoute.value.path).toBe(`/campaigns/${c.id}`)
  })

  it('discard routes back to the detail page without saving', async () => {
    const store = useCampaignStore()
    const c = store.create({ name: 'Old' })
    await router.push(`/campaigns/${c.id}/edit`)
    await router.isReady()
    const w = mount(CampaignEditPage, { global: { plugins: [router] } })
    await w.get('#campaign-name').setValue('Discarded')
    const cancel = w.findAll('button').find((b) => b.text() === 'Discard')
    await cancel!.trigger('click')
    await flushPromises()
    expect(store.all.find((x) => x.id === c.id)?.name).toBe('Old')
    expect(router.currentRoute.value.path).toBe(`/campaigns/${c.id}`)
  })
})
