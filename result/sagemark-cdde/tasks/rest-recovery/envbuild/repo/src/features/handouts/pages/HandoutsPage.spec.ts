import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'

import HandoutsPage from './HandoutsPage.vue'
import { useCampaignStore } from '@features/campaigns/store'
import { useHandoutStore } from '../store'

function makeRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { template: '<div />' } },
      { path: '/campaigns', component: { template: '<div />' } },
      { path: '/campaigns/:campaignId', component: { template: '<div />' } },
      { path: '/campaigns/:campaignId/handouts', component: HandoutsPage },
    ],
  })
}

describe('HandoutsPage', () => {
  let router: Router

  beforeEach(async () => {
    setActivePinia(createPinia())
    window.localStorage.clear()
    router = makeRouter()
  })

  it('shows not-found when campaign is missing', async () => {
    await router.push('/campaigns/camp_MISSING/handouts')
    await router.isReady()
    const w = mount(HandoutsPage, { global: { plugins: [router] } })
    expect(w.text()).toContain('Campaign not found')
  })

  it('shows empty state with no handouts', async () => {
    const c = useCampaignStore().create({ name: 'X' })
    await router.push(`/campaigns/${c.id}/handouts`)
    await router.isReady()
    const w = mount(HandoutsPage, { global: { plugins: [router] } })
    expect(w.text()).toContain('No handouts here')
  })

  it('creates a handout via the form', async () => {
    const c = useCampaignStore().create({ name: 'X' })
    const store = useHandoutStore()
    await router.push(`/campaigns/${c.id}/handouts`)
    await router.isReady()
    const w = mount(HandoutsPage, { global: { plugins: [router] } })
    await w.get('#handout-title').setValue('The frost letter')
    await w.find('form').trigger('submit.prevent')
    await flushPromises()
    expect(store.forCampaign(c.id)).toHaveLength(1)
    expect(w.text()).toContain('The frost letter')
  })

  it('share toggles visibility', async () => {
    const c = useCampaignStore().create({ name: 'X' })
    const store = useHandoutStore()
    const h = store.create({ campaignId: c.id, title: 'X' })
    await router.push(`/campaigns/${c.id}/handouts`)
    await router.isReady()
    const w = mount(HandoutsPage, { global: { plugins: [router] } })
    const btn = w.findAll('button').find((b) => b.text() === 'share')
    await btn!.trigger('click')
    expect(store.byId(h.id)?.visibility).toBe('shared')
  })

  it('filters by visibility via the select', async () => {
    const c = useCampaignStore().create({ name: 'X' })
    const store = useHandoutStore()
    store.create({ campaignId: c.id, title: 'The Frost Compact', visibility: 'draft' })
    store.create({ campaignId: c.id, title: 'Wanted Poster', visibility: 'shared' })
    await router.push(`/campaigns/${c.id}/handouts`)
    await router.isReady()
    const w = mount(HandoutsPage, { global: { plugins: [router] } })
    await w.get('#handout-filter').setValue('shared')
    expect(w.text()).toContain('Wanted Poster')
    expect(w.text()).not.toContain('The Frost Compact')
  })

  it('deletes with confirm', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const c = useCampaignStore().create({ name: 'X' })
    const store = useHandoutStore()
    const h = store.create({ campaignId: c.id, title: 'X' })
    await router.push(`/campaigns/${c.id}/handouts`)
    await router.isReady()
    const w = mount(HandoutsPage, { global: { plugins: [router] } })
    const del = w.findAll('button').find((b) => b.text() === 'delete')
    await del!.trigger('click')
    expect(store.byId(h.id)).toBe(null)
    confirmSpy.mockRestore()
  })
})
