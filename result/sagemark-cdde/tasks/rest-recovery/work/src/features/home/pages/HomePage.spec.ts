import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'

import HomePage from './HomePage.vue'
import { useCampaignStore } from '@features/campaigns/store'

function makeRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: HomePage },
      { path: '/campaigns', component: { template: '<div />' } },
      { path: '/campaigns/new', component: { template: '<div />' } },
    ],
  })
}

describe('HomePage', () => {
  let router: Router

  beforeEach(async () => {
    setActivePinia(createPinia())
    window.localStorage.clear()
    router = makeRouter()
    await router.push('/')
    await router.isReady()
  })

  it('shows the start-one CTA when there are no campaigns', () => {
    const w = mount(HomePage, { global: { plugins: [router] } })
    expect(w.text()).toContain('Pick up where you left off')
    expect(w.text()).toContain('Start one')
  })

  it('shows choose-a-campaign when there are some but none is active', () => {
    const store = useCampaignStore()
    store.create({ name: 'A' })
    store.setActive(null)
    const w = mount(HomePage, { global: { plugins: [router] } })
    expect(w.text()).toContain('Choose a campaign')
  })

  it('shows the active campaign detail when one is active', () => {
    const store = useCampaignStore()
    const c = store.create({ name: 'Frozen Gate', tagline: 'cold realm', system: 'dnd5e', status: 'active' })
    store.setActive(c.id)
    const w = mount(HomePage, { global: { plugins: [router] } })
    expect(w.text()).toContain('Frozen Gate')
    expect(w.text()).toContain('cold realm')
    expect(w.text()).toContain('D&D 5e')
  })

  it('formats no-sessions-yet phrasing', () => {
    const store = useCampaignStore()
    const c = store.create({ name: 'X' })
    store.setActive(c.id)
    const w = mount(HomePage, { global: { plugins: [router] } })
    expect(w.text().toLowerCase()).toContain('no sessions logged yet')
  })

  it('reports tracking count', () => {
    const store = useCampaignStore()
    store.create({ name: 'a', status: 'active' })
    store.create({ name: 'b', status: 'archived' })
    const w = mount(HomePage, { global: { plugins: [router] } })
    expect(w.text()).toContain('1 of 2 campaigns')
  })
})
