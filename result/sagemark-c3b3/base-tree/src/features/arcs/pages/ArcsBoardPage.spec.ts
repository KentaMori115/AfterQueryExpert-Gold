import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'

import ArcsBoardPage from './ArcsBoardPage.vue'
import { useCampaignStore } from '@features/campaigns/store'
import { useArcStore } from '../store'

function makeRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { template: '<div />' } },
      { path: '/campaigns', component: { template: '<div />' } },
      { path: '/campaigns/:campaignId', component: { template: '<div />' } },
      { path: '/campaigns/:campaignId/arcs', component: ArcsBoardPage },
      { path: '/campaigns/:campaignId/arcs/new', component: { template: '<div />' } },
      { path: '/campaigns/:campaignId/arcs/:id', component: { template: '<div />' } },
    ],
  })
}

describe('ArcsBoardPage', () => {
  let router: Router

  beforeEach(async () => {
    setActivePinia(createPinia())
    window.localStorage.clear()
    router = makeRouter()
  })

  it('not-found when campaign is missing', async () => {
    await router.push('/campaigns/camp_MISSING/arcs')
    await router.isReady()
    const w = mount(ArcsBoardPage, { global: { plugins: [router] } })
    expect(w.text()).toContain('Campaign not found')
  })

  it('shows empty state with zero arcs', async () => {
    const cStore = useCampaignStore()
    const c = cStore.create({ name: 'X' })
    await router.push(`/campaigns/${c.id}/arcs`)
    await router.isReady()
    const w = mount(ArcsBoardPage, { global: { plugins: [router] } })
    expect(w.text()).toContain('No arcs yet')
  })

  it('renders one column per status', async () => {
    const cStore = useCampaignStore()
    const aStore = useArcStore()
    const c = cStore.create({ name: 'X' })
    aStore.create({ campaignId: c.id, title: 'one', status: 'seeded' })
    await router.push(`/campaigns/${c.id}/arcs`)
    await router.isReady()
    const w = mount(ArcsBoardPage, { global: { plugins: [router] } })
    const cols = w.findAll('section').filter((s) => s.html().includes('uppercase'))
    expect(cols.length).toBeGreaterThanOrEqual(5)
    expect(w.text()).toContain('Seeded')
    expect(w.text()).toContain('Active')
    expect(w.text()).toContain('Climbing')
    expect(w.text()).toContain('Resolved')
    expect(w.text()).toContain('Shelved')
  })

  it('places arcs under their status column', async () => {
    const cStore = useCampaignStore()
    const aStore = useArcStore()
    const c = cStore.create({ name: 'X' })
    aStore.create({ campaignId: c.id, title: 'AArc', status: 'active' })
    aStore.create({ campaignId: c.id, title: 'BArc', status: 'climbing' })
    await router.push(`/campaigns/${c.id}/arcs`)
    await router.isReady()
    const w = mount(ArcsBoardPage, { global: { plugins: [router] } })
    expect(w.text()).toContain('AArc')
    expect(w.text()).toContain('BArc')
  })

  it('reports in-motion / total meta', async () => {
    const cStore = useCampaignStore()
    const aStore = useArcStore()
    const c = cStore.create({ name: 'X' })
    aStore.create({ campaignId: c.id, title: 'A', status: 'active' })
    aStore.create({ campaignId: c.id, title: 'R', status: 'resolved' })
    await router.push(`/campaigns/${c.id}/arcs`)
    await router.isReady()
    const w = mount(ArcsBoardPage, { global: { plugins: [router] } })
    expect(w.text()).toContain('1 in motion / 2 total')
  })
})
