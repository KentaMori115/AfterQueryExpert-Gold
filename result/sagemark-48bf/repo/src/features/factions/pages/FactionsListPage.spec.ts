import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'

import FactionsListPage from './FactionsListPage.vue'
import { useCampaignStore } from '@features/campaigns/store'
import { useFactionStore } from '../store'

function makeRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { template: '<div />' } },
      { path: '/campaigns', component: { template: '<div />' } },
      { path: '/campaigns/:campaignId', component: { template: '<div />' } },
      { path: '/campaigns/:campaignId/factions', component: FactionsListPage },
      { path: '/campaigns/:campaignId/factions/new', component: { template: '<div />' } },
      { path: '/campaigns/:campaignId/factions/:id', component: { template: '<div />' } },
    ],
  })
}

describe('FactionsListPage', () => {
  let router: Router

  beforeEach(async () => {
    setActivePinia(createPinia())
    window.localStorage.clear()
    router = makeRouter()
  })

  it('shows not-found when campaign is missing', async () => {
    await router.push('/campaigns/camp_MISSING/factions')
    await router.isReady()
    const w = mount(FactionsListPage, { global: { plugins: [router] } })
    expect(w.text()).toContain('Campaign not found')
  })

  it('shows empty state when no factions exist', async () => {
    const cStore = useCampaignStore()
    const c = cStore.create({ name: 'X' })
    await router.push(`/campaigns/${c.id}/factions`)
    await router.isReady()
    const w = mount(FactionsListPage, { global: { plugins: [router] } })
    expect(w.text()).toContain('No factions yet')
  })

  it('sorts active factions by influence descending', async () => {
    const cStore = useCampaignStore()
    const fStore = useFactionStore()
    const c = cStore.create({ name: 'X' })
    fStore.create({ campaignId: c.id, name: 'Low', influence: 20 })
    fStore.create({ campaignId: c.id, name: 'High', influence: 80 })
    fStore.create({ campaignId: c.id, name: 'Mid', influence: 50 })
    await router.push(`/campaigns/${c.id}/factions`)
    await router.isReady()
    const w = mount(FactionsListPage, { global: { plugins: [router] } })
    const text = w.text()
    expect(text.indexOf('High')).toBeLessThan(text.indexOf('Mid'))
    expect(text.indexOf('Mid')).toBeLessThan(text.indexOf('Low'))
  })

  it('puts inactive factions under a Dormant heading', async () => {
    const cStore = useCampaignStore()
    const fStore = useFactionStore()
    const c = cStore.create({ name: 'X' })
    fStore.create({ campaignId: c.id, name: 'gone', active: false })
    await router.push(`/campaigns/${c.id}/factions`)
    await router.isReady()
    const w = mount(FactionsListPage, { global: { plugins: [router] } })
    expect(w.text()).toContain('Dormant')
  })

  it('reports the active/total meta', async () => {
    const cStore = useCampaignStore()
    const fStore = useFactionStore()
    const c = cStore.create({ name: 'X' })
    fStore.create({ campaignId: c.id, name: 'A' })
    fStore.create({ campaignId: c.id, name: 'B', active: false })
    await router.push(`/campaigns/${c.id}/factions`)
    await router.isReady()
    const w = mount(FactionsListPage, { global: { plugins: [router] } })
    expect(w.text()).toContain('1 active / 2 total')
  })
})
