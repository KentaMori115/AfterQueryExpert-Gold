import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'

import LocationDetailPage from './LocationDetailPage.vue'
import { useCampaignStore } from '@features/campaigns/store'
import { useLocationStore } from '../store'

function makeRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { template: '<div />' } },
      { path: '/campaigns', component: { template: '<div />' } },
      { path: '/campaigns/:campaignId', component: { template: '<div />' } },
      { path: '/campaigns/:campaignId/locations', component: { template: '<div />' } },
      { path: '/campaigns/:campaignId/locations/:id', component: LocationDetailPage },
      { path: '/campaigns/:campaignId/locations/:id/edit', component: { template: '<div />' } },
    ],
  })
}

describe('LocationDetailPage', () => {
  let router: Router

  beforeEach(async () => {
    setActivePinia(createPinia())
    window.localStorage.clear()
    router = makeRouter()
  })

  it('not-found for missing location', async () => {
    const cStore = useCampaignStore()
    const c = cStore.create({ name: 'X' })
    await router.push(`/campaigns/${c.id}/locations/loc_MISSING000`)
    await router.isReady()
    const w = mount(LocationDetailPage, { global: { plugins: [router] } })
    expect(w.text()).toContain('Not found')
  })

  it('renders the location summary', async () => {
    const cStore = useCampaignStore()
    const lStore = useLocationStore()
    const c = cStore.create({ name: 'X' })
    const l = lStore.create({ campaignId: c.id, name: 'Frostfell', kind: 'region', notes: 'snowy place' })
    await router.push(`/campaigns/${c.id}/locations/${l.id}`)
    await router.isReady()
    const w = mount(LocationDetailPage, { global: { plugins: [router] } })
    expect(w.text()).toContain('Frostfell')
    expect(w.text()).toContain('Region')
    expect(w.text()).toContain('snowy place')
  })

  it('lists children when present', async () => {
    const cStore = useCampaignStore()
    const lStore = useLocationStore()
    const c = cStore.create({ name: 'X' })
    const r = lStore.create({ campaignId: c.id, name: 'Root' })
    lStore.create({ campaignId: c.id, name: 'ChildLoc', parentId: r.id })
    await router.push(`/campaigns/${c.id}/locations/${r.id}`)
    await router.isReady()
    const w = mount(LocationDetailPage, { global: { plugins: [router] } })
    expect(w.text()).toContain('Inside this place')
    expect(w.text()).toContain('ChildLoc')
  })

  it('toggles visited via the button', async () => {
    const cStore = useCampaignStore()
    const lStore = useLocationStore()
    const c = cStore.create({ name: 'X' })
    const l = lStore.create({ campaignId: c.id, name: 'X' })
    await router.push(`/campaigns/${c.id}/locations/${l.id}`)
    await router.isReady()
    const w = mount(LocationDetailPage, { global: { plugins: [router] } })
    const visit = w.findAll('button').find((b) => b.text() === 'Mark visited')
    await visit!.trigger('click')
    expect(lStore.byId(l.id)?.visited).toBe(true)
  })

  it('delete a leaf with confirm', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const cStore = useCampaignStore()
    const lStore = useLocationStore()
    const c = cStore.create({ name: 'X' })
    const l = lStore.create({ campaignId: c.id, name: 'X' })
    await router.push(`/campaigns/${c.id}/locations/${l.id}`)
    await router.isReady()
    const w = mount(LocationDetailPage, { global: { plugins: [router] } })
    const del = w.findAll('button').find((b) => b.text() === 'Delete')
    await del!.trigger('click')
    await flushPromises()
    expect(lStore.byId(l.id)).toBe(null)
    expect(router.currentRoute.value.path).toBe(`/campaigns/${c.id}/locations`)
    confirmSpy.mockRestore()
  })

  it('delete subtree label when children exist', async () => {
    const cStore = useCampaignStore()
    const lStore = useLocationStore()
    const c = cStore.create({ name: 'X' })
    const r = lStore.create({ campaignId: c.id, name: 'R' })
    lStore.create({ campaignId: c.id, name: 'C', parentId: r.id })
    await router.push(`/campaigns/${c.id}/locations/${r.id}`)
    await router.isReady()
    const w = mount(LocationDetailPage, { global: { plugins: [router] } })
    const del = w.findAll('button').find((b) => b.text() === 'Delete subtree')
    expect(del).toBeDefined()
  })
})
