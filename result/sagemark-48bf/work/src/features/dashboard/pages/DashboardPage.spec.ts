import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'

import DashboardPage from './DashboardPage.vue'
import { useCampaignStore } from '@features/campaigns/store'
import { useCharacterStore } from '@features/characters/store'

function makeRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { template: '<div />' } },
      { path: '/dashboard', component: DashboardPage },
      { path: '/:rest(.*)', component: { template: '<div />' } },
    ],
  })
}

describe('DashboardPage', () => {
  let router: Router

  beforeEach(async () => {
    setActivePinia(createPinia())
    window.localStorage.clear()
    router = makeRouter()
    await router.push('/dashboard')
    await router.isReady()
  })

  it('renders the empty state when there are no campaigns', () => {
    const w = mount(DashboardPage, { global: { plugins: [router] } })
    expect(w.text()).toContain('No campaigns yet')
  })

  it('renders the totals when campaigns exist', () => {
    const campaigns = useCampaignStore()
    const c = campaigns.create({ name: 'X', status: 'active' })
    useCharacterStore().create({ campaignId: c.id, name: 'Iris' })
    const w = mount(DashboardPage, { global: { plugins: [router] } })
    expect(w.text()).toContain('1 / 1')
  })

  it('lists campaign summaries with link to detail', () => {
    const campaigns = useCampaignStore()
    const c = campaigns.create({ name: 'Frozen Gate' })
    const w = mount(DashboardPage, { global: { plugins: [router] } })
    expect(w.text()).toContain('Frozen Gate')
    const links = w.findAll('a').map((a) => a.attributes('href'))
    expect(links).toContain(`/campaigns/${c.id}`)
  })
})
