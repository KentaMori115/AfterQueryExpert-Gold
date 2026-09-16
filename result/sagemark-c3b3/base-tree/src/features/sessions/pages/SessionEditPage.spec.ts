import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'

import SessionEditPage from './SessionEditPage.vue'
import { useCampaignStore } from '@features/campaigns/store'
import { useSessionStore } from '../store'

function makeRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { template: '<div />' } },
      { path: '/campaigns', component: { template: '<div />' } },
      { path: '/campaigns/:campaignId', component: { template: '<div />' } },
      { path: '/campaigns/:campaignId/sessions', component: { template: '<div />' } },
      { path: '/campaigns/:campaignId/sessions/:id', component: { template: '<div />' } },
      { path: '/campaigns/:campaignId/sessions/:id/edit', component: SessionEditPage },
    ],
  })
}

describe('SessionEditPage', () => {
  let router: Router

  beforeEach(async () => {
    setActivePinia(createPinia())
    window.localStorage.clear()
    router = makeRouter()
  })

  it('not-found for missing session', async () => {
    const cStore = useCampaignStore()
    const c = cStore.create({ name: 'X' })
    await router.push(`/campaigns/${c.id}/sessions/ses_MISSING/edit`)
    await router.isReady()
    const w = mount(SessionEditPage, { global: { plugins: [router] } })
    expect(w.text()).toContain('Not found')
  })

  it('seeds the form', async () => {
    const cStore = useCampaignStore()
    const sStore = useSessionStore()
    const c = cStore.create({ name: 'X' })
    const s = sStore.create({ campaignId: c.id, title: 'Old title', playedAt: '2025-04-01T20:00:00Z' })
    await router.push(`/campaigns/${c.id}/sessions/${s.id}/edit`)
    await router.isReady()
    const w = mount(SessionEditPage, { global: { plugins: [router] } })
    expect((w.get('#session-title').element as HTMLInputElement).value).toBe('Old title')
  })

  it('saves and routes back to detail', async () => {
    const cStore = useCampaignStore()
    const sStore = useSessionStore()
    const c = cStore.create({ name: 'X' })
    const s = sStore.create({ campaignId: c.id, title: 'Old', playedAt: '2025-04-01T20:00:00Z' })
    await router.push(`/campaigns/${c.id}/sessions/${s.id}/edit`)
    await router.isReady()
    const w = mount(SessionEditPage, { global: { plugins: [router] } })
    await w.get('#session-title').setValue('New')
    await w.find('form').trigger('submit.prevent')
    await flushPromises()
    expect(sStore.byId(s.id)?.title).toBe('New')
    expect(router.currentRoute.value.path).toBe(`/campaigns/${c.id}/sessions/${s.id}`)
  })

  it('discard leaves data alone', async () => {
    const cStore = useCampaignStore()
    const sStore = useSessionStore()
    const c = cStore.create({ name: 'X' })
    const s = sStore.create({ campaignId: c.id, title: 'Old', playedAt: '2025-04-01T20:00:00Z' })
    await router.push(`/campaigns/${c.id}/sessions/${s.id}/edit`)
    await router.isReady()
    const w = mount(SessionEditPage, { global: { plugins: [router] } })
    await w.get('#session-title').setValue('Junk')
    const cancel = w.findAll('button').find((b) => b.text() === 'Discard')
    await cancel!.trigger('click')
    await flushPromises()
    expect(sStore.byId(s.id)?.title).toBe('Old')
  })
})
