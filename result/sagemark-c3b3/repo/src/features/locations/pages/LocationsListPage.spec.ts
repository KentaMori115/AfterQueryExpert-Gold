import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'

import LocationsListPage from './LocationsListPage.vue'
import { useCampaignStore } from '@features/campaigns/store'
import { useLocationStore } from '../store'

function makeRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { template: '<div />' } },
      { path: '/campaigns', component: { template: '<div />' } },
      { path: '/campaigns/:campaignId', component: { template: '<div />' } },
      { path: '/campaigns/:campaignId/locations', component: LocationsListPage },
      { path: '/campaigns/:campaignId/locations/new', component: { template: '<div />' } },
      { path: '/campaigns/:campaignId/locations/:id', component: { template: '<div />' } },
    ],
  })
}

describe('LocationsListPage', () => {
  let router: Router

  beforeEach(async () => {
    setActivePinia(createPinia())
    window.localStorage.clear()
    router = makeRouter()
  })

  it('not-found when campaign missing', async () => {
    await router.push('/campaigns/camp_MISSING/locations')
    await router.isReady()
    const w = mount(LocationsListPage, { global: { plugins: [router] } })
    expect(w.text()).toContain('Campaign not found')
  })

  it('shows empty state when no locations', async () => {
    const cStore = useCampaignStore()
    const c = cStore.create({ name: 'X' })
    await router.push(`/campaigns/${c.id}/locations`)
    await router.isReady()
    const w = mount(LocationsListPage, { global: { plugins: [router] } })
    expect(w.text()).toContain('No places mapped')
  })

  it('renders the tree', async () => {
    const cStore = useCampaignStore()
    const lStore = useLocationStore()
    const c = cStore.create({ name: 'X' })
    const root = lStore.create({ campaignId: c.id, name: 'World' })
    lStore.create({ campaignId: c.id, name: 'City', parentId: root.id })
    await router.push(`/campaigns/${c.id}/locations`)
    await router.isReady()
    const w = mount(LocationsListPage, { global: { plugins: [router] } })
    expect(w.text()).toContain('World')
    expect(w.text()).toContain('City')
  })

  it('reports the visited/total meta', async () => {
    const cStore = useCampaignStore()
    const lStore = useLocationStore()
    const c = cStore.create({ name: 'X' })
    lStore.create({ campaignId: c.id, name: 'A', visited: true })
    lStore.create({ campaignId: c.id, name: 'B' })
    await router.push(`/campaigns/${c.id}/locations`)
    await router.isReady()
    const w = mount(LocationsListPage, { global: { plugins: [router] } })
    expect(w.text()).toContain('1 visited / 2 mapped')
  })
})
