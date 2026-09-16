import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'

import ArcDetailPage from './ArcDetailPage.vue'
import { useCampaignStore } from '@features/campaigns/store'
import { useFactionStore } from '@features/factions/store'
import { useArcStore } from '../store'

function makeRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { template: '<div />' } },
      { path: '/campaigns', component: { template: '<div />' } },
      { path: '/campaigns/:campaignId', component: { template: '<div />' } },
      { path: '/campaigns/:campaignId/arcs', component: { template: '<div />' } },
      { path: '/campaigns/:campaignId/arcs/:id', component: ArcDetailPage },
      { path: '/campaigns/:campaignId/arcs/:id/edit', component: { template: '<div />' } },
      { path: '/campaigns/:campaignId/factions/:id', component: { template: '<div />' } },
    ],
  })
}

describe('ArcDetailPage', () => {
  let router: Router

  beforeEach(async () => {
    setActivePinia(createPinia())
    window.localStorage.clear()
    router = makeRouter()
  })

  it('not-found for missing arc', async () => {
    const cStore = useCampaignStore()
    const c = cStore.create({ name: 'X' })
    await router.push(`/campaigns/${c.id}/arcs/arc_MISSING`)
    await router.isReady()
    const w = mount(ArcDetailPage, { global: { plugins: [router] } })
    expect(w.text()).toContain('Not found')
  })

  it('shows arc details', async () => {
    const cStore = useCampaignStore()
    const aStore = useArcStore()
    const c = cStore.create({ name: 'X' })
    const a = aStore.create({ campaignId: c.id, title: 'Winter', synopsis: 'frost' })
    await router.push(`/campaigns/${c.id}/arcs/${a.id}`)
    await router.isReady()
    const w = mount(ArcDetailPage, { global: { plugins: [router] } })
    expect(w.text()).toContain('Winter')
    expect(w.text()).toContain('frost')
  })

  it('changes status via the pill row', async () => {
    const cStore = useCampaignStore()
    const aStore = useArcStore()
    const c = cStore.create({ name: 'X' })
    const a = aStore.create({ campaignId: c.id, title: 'X' })
    await router.push(`/campaigns/${c.id}/arcs/${a.id}`)
    await router.isReady()
    const w = mount(ArcDetailPage, { global: { plugins: [router] } })
    const climb = w.findAll('button').find((b) => b.text() === 'Climbing')
    await climb!.trigger('click')
    expect(aStore.byId(a.id)?.status).toBe('climbing')
  })

  it('changes tension via the row', async () => {
    const cStore = useCampaignStore()
    const aStore = useArcStore()
    const c = cStore.create({ name: 'X' })
    const a = aStore.create({ campaignId: c.id, title: 'X' })
    await router.push(`/campaigns/${c.id}/arcs/${a.id}`)
    await router.isReady()
    const w = mount(ArcDetailPage, { global: { plugins: [router] } })
    const breaking = w.findAll('button').find((b) => b.text() === 'Breaking')
    await breaking!.trigger('click')
    expect(aStore.byId(a.id)?.tension).toBe('breaking')
  })

  it('renders linked factions', async () => {
    const cStore = useCampaignStore()
    const aStore = useArcStore()
    const fStore = useFactionStore()
    const c = cStore.create({ name: 'X' })
    const fac = fStore.create({ campaignId: c.id, name: 'Order of Frost' })
    const a = aStore.create({ campaignId: c.id, title: 'X', primaryFactionId: fac.id })
    await router.push(`/campaigns/${c.id}/arcs/${a.id}`)
    await router.isReady()
    const w = mount(ArcDetailPage, { global: { plugins: [router] } })
    expect(w.text()).toContain('Order of Frost')
  })

  it('delete with confirm removes', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const cStore = useCampaignStore()
    const aStore = useArcStore()
    const c = cStore.create({ name: 'X' })
    const a = aStore.create({ campaignId: c.id, title: 'X' })
    await router.push(`/campaigns/${c.id}/arcs/${a.id}`)
    await router.isReady()
    const w = mount(ArcDetailPage, { global: { plugins: [router] } })
    const del = w.findAll('button').find((b) => b.text() === 'Delete this arc')
    await del!.trigger('click')
    await flushPromises()
    expect(aStore.byId(a.id)).toBe(null)
    confirmSpy.mockRestore()
  })
})
