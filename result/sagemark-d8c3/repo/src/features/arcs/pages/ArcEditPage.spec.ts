import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'

import ArcEditPage from './ArcEditPage.vue'
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
      { path: '/campaigns/:campaignId/arcs/:id', component: { template: '<div />' } },
      { path: '/campaigns/:campaignId/arcs/:id/edit', component: ArcEditPage },
    ],
  })
}

describe('ArcEditPage', () => {
  let router: Router

  beforeEach(async () => {
    setActivePinia(createPinia())
    window.localStorage.clear()
    router = makeRouter()
  })

  it('not-found for missing arc', async () => {
    const cStore = useCampaignStore()
    const c = cStore.create({ name: 'X' })
    await router.push(`/campaigns/${c.id}/arcs/arc_MISSING/edit`)
    await router.isReady()
    const w = mount(ArcEditPage, { global: { plugins: [router] } })
    expect(w.text()).toContain('Not found')
  })

  it('seeds form values', async () => {
    const cStore = useCampaignStore()
    const aStore = useArcStore()
    const c = cStore.create({ name: 'X' })
    const a = aStore.create({ campaignId: c.id, title: 'Winter', status: 'climbing' })
    await router.push(`/campaigns/${c.id}/arcs/${a.id}/edit`)
    await router.isReady()
    const w = mount(ArcEditPage, { global: { plugins: [router] } })
    expect((w.get('#arc-title').element as HTMLInputElement).value).toBe('Winter')
    expect((w.get('#arc-status').element as HTMLSelectElement).value).toBe('climbing')
  })

  it('saves and routes to detail', async () => {
    const cStore = useCampaignStore()
    const aStore = useArcStore()
    const c = cStore.create({ name: 'X' })
    const a = aStore.create({ campaignId: c.id, title: 'Old' })
    await router.push(`/campaigns/${c.id}/arcs/${a.id}/edit`)
    await router.isReady()
    const w = mount(ArcEditPage, { global: { plugins: [router] } })
    await w.get('#arc-title').setValue('New')
    await w.find('form').trigger('submit.prevent')
    await flushPromises()
    expect(aStore.byId(a.id)?.title).toBe('New')
  })

  it('discard leaves data alone', async () => {
    const cStore = useCampaignStore()
    const aStore = useArcStore()
    const c = cStore.create({ name: 'X' })
    const a = aStore.create({ campaignId: c.id, title: 'Old' })
    await router.push(`/campaigns/${c.id}/arcs/${a.id}/edit`)
    await router.isReady()
    const w = mount(ArcEditPage, { global: { plugins: [router] } })
    await w.get('#arc-title').setValue('Junk')
    const cancel = w.findAll('button').find((b) => b.text() === 'Discard')
    await cancel!.trigger('click')
    await flushPromises()
    expect(aStore.byId(a.id)?.title).toBe('Old')
  })
})
