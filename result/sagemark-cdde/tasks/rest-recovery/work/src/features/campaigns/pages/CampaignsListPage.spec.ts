import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'

import CampaignsListPage from './CampaignsListPage.vue'
import { useCampaignStore } from '../store'

function makeRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { template: '<div />' } },
      { path: '/campaigns', component: CampaignsListPage },
      { path: '/campaigns/new', component: { template: '<div />' } },
      { path: '/campaigns/:id', component: { template: '<div />' } },
    ],
  })
}

describe('CampaignsListPage', () => {
  let router: Router

  beforeEach(async () => {
    setActivePinia(createPinia())
    window.localStorage.clear()
    router = makeRouter()
    await router.push('/campaigns')
    await router.isReady()
  })

  it('shows the empty state when no campaigns exist', () => {
    const w = mount(CampaignsListPage, { global: { plugins: [router] } })
    expect(w.text()).toContain('No campaigns yet')
    expect(w.text()).toContain('Create one now')
  })

  it('shows campaign tiles when there are open campaigns', () => {
    const store = useCampaignStore()
    store.create({ name: 'Frozen Gate', status: 'active' })
    store.create({ name: 'Spire of Salt', status: 'planning' })
    const w = mount(CampaignsListPage, { global: { plugins: [router] } })
    expect(w.text()).toContain('Frozen Gate')
    expect(w.text()).toContain('Spire of Salt')
    expect(w.text()).toContain('In play')
  })

  it('reports the open/total meta', () => {
    const store = useCampaignStore()
    store.create({ name: 'A', status: 'active' })
    store.create({ name: 'B', status: 'archived' })
    const w = mount(CampaignsListPage, { global: { plugins: [router] } })
    expect(w.text()).toContain('1 open / 2 total')
  })

  it('puts archived ones under a Shelved heading', () => {
    const store = useCampaignStore()
    store.create({ name: 'shelf', status: 'archived' })
    const w = mount(CampaignsListPage, { global: { plugins: [router] } })
    expect(w.text()).toContain('Shelved')
  })

  it('renders a router link per campaign tile', () => {
    const store = useCampaignStore()
    const a = store.create({ name: 'A', status: 'active' })
    const b = store.create({ name: 'B', status: 'archived' })
    const w = mount(CampaignsListPage, { global: { plugins: [router] } })
    const hrefs = w.findAll('a').map((link) => link.attributes('href'))
    expect(hrefs).toContain(`/campaigns/${a.id}`)
    expect(hrefs).toContain(`/campaigns/${b.id}`)
  })
})
