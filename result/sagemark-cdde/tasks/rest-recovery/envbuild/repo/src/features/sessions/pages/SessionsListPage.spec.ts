import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'

import SessionsListPage from './SessionsListPage.vue'
import { useCampaignStore } from '@features/campaigns/store'
import { useSessionStore } from '../store'

function makeRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { template: '<div />' } },
      { path: '/campaigns', component: { template: '<div />' } },
      { path: '/campaigns/:campaignId', component: { template: '<div />' } },
      { path: '/campaigns/:campaignId/sessions', component: SessionsListPage },
      { path: '/campaigns/:campaignId/sessions/new', component: { template: '<div />' } },
      { path: '/campaigns/:campaignId/sessions/:id', component: { template: '<div />' } },
    ],
  })
}

describe('SessionsListPage', () => {
  let router: Router

  beforeEach(async () => {
    setActivePinia(createPinia())
    window.localStorage.clear()
    router = makeRouter()
  })

  it('not-found when campaign missing', async () => {
    await router.push('/campaigns/camp_MISSING/sessions')
    await router.isReady()
    const w = mount(SessionsListPage, { global: { plugins: [router] } })
    expect(w.text()).toContain('Campaign not found')
  })

  it('shows empty state', async () => {
    const cStore = useCampaignStore()
    const c = cStore.create({ name: 'X' })
    await router.push(`/campaigns/${c.id}/sessions`)
    await router.isReady()
    const w = mount(SessionsListPage, { global: { plugins: [router] } })
    expect(w.text()).toContain('No sessions yet')
  })

  it('shows sessions newest first', async () => {
    const cStore = useCampaignStore()
    const sStore = useSessionStore()
    const c = cStore.create({ name: 'X' })
    sStore.create({ campaignId: c.id, title: 'old', playedAt: '2025-01-01T20:00:00Z' })
    sStore.create({ campaignId: c.id, title: 'newer', playedAt: '2025-03-01T20:00:00Z' })
    await router.push(`/campaigns/${c.id}/sessions`)
    await router.isReady()
    const w = mount(SessionsListPage, { global: { plugins: [router] } })
    const text = w.text()
    expect(text.indexOf('newer')).toBeLessThan(text.indexOf('old'))
  })

  it('reports a count meta', async () => {
    const cStore = useCampaignStore()
    const sStore = useSessionStore()
    const c = cStore.create({ name: 'X' })
    sStore.create({ campaignId: c.id, title: 'a', playedAt: '2025-04-01T20:00:00Z' })
    sStore.create({ campaignId: c.id, title: 'b', playedAt: '2025-04-08T20:00:00Z' })
    await router.push(`/campaigns/${c.id}/sessions`)
    await router.isReady()
    const w = mount(SessionsListPage, { global: { plugins: [router] } })
    expect(w.text()).toContain('2 logged')
  })
})
