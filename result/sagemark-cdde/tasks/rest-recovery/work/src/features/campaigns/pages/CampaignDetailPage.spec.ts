import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'

import CampaignDetailPage from './CampaignDetailPage.vue'
import { useCampaignStore } from '../store'

function makeRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { template: '<div />' } },
      { path: '/campaigns', component: { template: '<div />' } },
      { path: '/campaigns/:id', component: CampaignDetailPage },
      { path: '/campaigns/:id/edit', component: { template: '<div />' } },
    ],
  })
}

describe('CampaignDetailPage', () => {
  let router: Router

  beforeEach(async () => {
    setActivePinia(createPinia())
    window.localStorage.clear()
    router = makeRouter()
  })

  it('shows a not-found state when the id is unknown', async () => {
    await router.push('/campaigns/camp_MISSING000')
    await router.isReady()
    const w = mount(CampaignDetailPage, { global: { plugins: [router] } })
    expect(w.text()).toContain('Campaign not found')
  })

  it('shows the campaign details when it exists', async () => {
    const store = useCampaignStore()
    const c = store.create({ name: 'Frozen Gate', tagline: 'cold' })
    await router.push(`/campaigns/${c.id}`)
    await router.isReady()
    const w = mount(CampaignDetailPage, { global: { plugins: [router] } })
    expect(w.text()).toContain('Frozen Gate')
    expect(w.text()).toContain('cold')
  })

  it('activate button switches the active campaign', async () => {
    const store = useCampaignStore()
    const a = store.create({ name: 'A' })
    const b = store.create({ name: 'B' })
    // store auto-activated a; visit b's detail
    await router.push(`/campaigns/${b.id}`)
    await router.isReady()
    const w = mount(CampaignDetailPage, { global: { plugins: [router] } })
    const activateBtn = w.findAll('button').find((btn) => btn.text() === 'Make active')
    expect(activateBtn).toBeDefined()
    await activateBtn!.trigger('click')
    expect(store.activeId).toBe(b.id)
    expect(a.id).not.toBe(b.id)
  })

  it('archive button moves status to archived', async () => {
    const store = useCampaignStore()
    const c = store.create({ name: 'X', status: 'active' })
    await router.push(`/campaigns/${c.id}`)
    await router.isReady()
    const w = mount(CampaignDetailPage, { global: { plugins: [router] } })
    const archiveBtn = w.findAll('button').find((btn) => btn.text() === 'Archive')
    await archiveBtn!.trigger('click')
    expect(store.all.find((x) => x.id === c.id)?.status).toBe('archived')
  })

  it('unarchive replaces archive on archived campaigns', async () => {
    const store = useCampaignStore()
    const c = store.create({ name: 'X', status: 'archived' })
    await router.push(`/campaigns/${c.id}`)
    await router.isReady()
    const w = mount(CampaignDetailPage, { global: { plugins: [router] } })
    expect(w.findAll('button').find((b) => b.text() === 'Archive')).toBeUndefined()
    const unarchiveBtn = w.findAll('button').find((b) => b.text() === 'Unarchive')
    await unarchiveBtn!.trigger('click')
    expect(store.all.find((x) => x.id === c.id)?.status).toBe('active')
  })

  it('delete with confirm removes the campaign and routes away', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const store = useCampaignStore()
    const c = store.create({ name: 'X' })
    await router.push(`/campaigns/${c.id}`)
    await router.isReady()
    const w = mount(CampaignDetailPage, { global: { plugins: [router] } })
    const del = w.findAll('button').find((b) => b.text() === 'Delete forever')
    await del!.trigger('click')
    await flushPromises()
    expect(store.all.find((x) => x.id === c.id)).toBeUndefined()
    expect(router.currentRoute.value.path).toBe('/campaigns')
    confirmSpy.mockRestore()
  })

  it('delete is cancelled when the user declines confirm', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const store = useCampaignStore()
    const c = store.create({ name: 'X' })
    await router.push(`/campaigns/${c.id}`)
    await router.isReady()
    const w = mount(CampaignDetailPage, { global: { plugins: [router] } })
    const del = w.findAll('button').find((b) => b.text() === 'Delete forever')
    await del!.trigger('click')
    expect(store.all.find((x) => x.id === c.id)).not.toBeUndefined()
    confirmSpy.mockRestore()
  })
})
