import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'

import LorePage from './LorePage.vue'
import { useCampaignStore } from '@features/campaigns/store'
import { useLoreStore } from '../store'

function makeRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { template: '<div />' } },
      { path: '/campaigns', component: { template: '<div />' } },
      { path: '/campaigns/:campaignId', component: { template: '<div />' } },
      { path: '/campaigns/:campaignId/lore', component: LorePage },
    ],
  })
}

describe('LorePage', () => {
  let router: Router

  beforeEach(async () => {
    setActivePinia(createPinia())
    window.localStorage.clear()
    router = makeRouter()
  })

  it('not-found when campaign missing', async () => {
    await router.push('/campaigns/camp_MISSING/lore')
    await router.isReady()
    const w = mount(LorePage, { global: { plugins: [router] } })
    expect(w.text()).toContain('Campaign not found')
  })

  it('shows empty state', async () => {
    const c = useCampaignStore().create({ name: 'X' })
    await router.push(`/campaigns/${c.id}/lore`)
    await router.isReady()
    const w = mount(LorePage, { global: { plugins: [router] } })
    expect(w.text()).toContain('Nothing in the lore book yet')
  })

  it('creates an entry via the form', async () => {
    const c = useCampaignStore().create({ name: 'X' })
    const loreStore = useLoreStore()
    await router.push(`/campaigns/${c.id}/lore`)
    await router.isReady()
    const w = mount(LorePage, { global: { plugins: [router] } })
    await w.get('#lore-title').setValue('The Frostbite Compact')
    await w.find('form').trigger('submit.prevent')
    await flushPromises()
    expect(loreStore.forCampaign(c.id)).toHaveLength(1)
    expect(w.text()).toContain('The Frostbite Compact')
  })

  it('filters by query', async () => {
    const c = useCampaignStore().create({ name: 'X' })
    const loreStore = useLoreStore()
    loreStore.create({ campaignId: c.id, title: 'Frost' })
    loreStore.create({ campaignId: c.id, title: 'Sun' })
    await router.push(`/campaigns/${c.id}/lore`)
    await router.isReady()
    const w = mount(LorePage, { global: { plugins: [router] } })
    const search = w.find('input[type="text"]')
    await search.setValue('frost')
    expect(w.text()).toContain('Frost')
    expect(w.text()).not.toContain('Sun')
  })

  it('toggles reveal', async () => {
    const c = useCampaignStore().create({ name: 'X' })
    const loreStore = useLoreStore()
    const e = loreStore.create({ campaignId: c.id, title: 'X' })
    await router.push(`/campaigns/${c.id}/lore`)
    await router.isReady()
    const w = mount(LorePage, { global: { plugins: [router] } })
    const btn = w.findAll('button').find((b) => b.text() === 'reveal')
    await btn!.trigger('click')
    expect(loreStore.byId(e.id)?.revealed).toBe(true)
  })

  it('category filter narrows the list', async () => {
    const c = useCampaignStore().create({ name: 'X' })
    const loreStore = useLoreStore()
    loreStore.create({ campaignId: c.id, title: 'A History', category: 'history' })
    loreStore.create({ campaignId: c.id, title: 'B Magic', category: 'magic' })
    await router.push(`/campaigns/${c.id}/lore`)
    await router.isReady()
    const w = mount(LorePage, { global: { plugins: [router] } })
    await w.find('#lore-category').setValue('magic')
    expect(w.text()).toContain('B Magic')
    expect(w.text()).not.toContain('A History')
  })

  it('deletes with confirm', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const c = useCampaignStore().create({ name: 'X' })
    const loreStore = useLoreStore()
    const e = loreStore.create({ campaignId: c.id, title: 'X' })
    await router.push(`/campaigns/${c.id}/lore`)
    await router.isReady()
    const w = mount(LorePage, { global: { plugins: [router] } })
    const del = w.findAll('button').find((b) => b.text() === 'delete')
    await del!.trigger('click')
    expect(loreStore.byId(e.id)).toBe(null)
    confirmSpy.mockRestore()
  })
})
