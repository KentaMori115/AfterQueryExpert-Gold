import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'

import SessionNewPage from './SessionNewPage.vue'
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
      { path: '/campaigns/:campaignId/sessions/new', component: SessionNewPage },
      { path: '/campaigns/:campaignId/sessions/:id', component: { template: '<div />' } },
    ],
  })
}

describe('SessionNewPage', () => {
  let router: Router

  beforeEach(async () => {
    setActivePinia(createPinia())
    window.localStorage.clear()
    router = makeRouter()
  })

  it('not-found when campaign missing', async () => {
    await router.push('/campaigns/camp_MISSING/sessions/new')
    await router.isReady()
    const w = mount(SessionNewPage, { global: { plugins: [router] } })
    expect(w.text()).toContain('Campaign not found')
  })

  it('creates session and bumps campaign session count', async () => {
    const cStore = useCampaignStore()
    const sStore = useSessionStore()
    const c = cStore.create({ name: 'X' })
    await router.push(`/campaigns/${c.id}/sessions/new`)
    await router.isReady()
    const w = mount(SessionNewPage, { global: { plugins: [router] } })
    await w.get('#session-title').setValue('Opener')
    await w.find('form').trigger('submit.prevent')
    await flushPromises()
    expect(sStore.forCampaign(c.id)).toHaveLength(1)
    expect(cStore.all.find((x) => x.id === c.id)?.sessionCount).toBe(1)
  })

  it('cancel routes back to list', async () => {
    const cStore = useCampaignStore()
    const c = cStore.create({ name: 'X' })
    await router.push(`/campaigns/${c.id}/sessions/new`)
    await router.isReady()
    const w = mount(SessionNewPage, { global: { plugins: [router] } })
    const back = w.findAll('button').find((b) => b.text() === 'Back')
    await back!.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe(`/campaigns/${c.id}/sessions`)
  })
})
