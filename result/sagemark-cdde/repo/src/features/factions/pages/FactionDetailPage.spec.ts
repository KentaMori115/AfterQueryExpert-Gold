import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'

import FactionDetailPage from './FactionDetailPage.vue'
import { useCampaignStore } from '@features/campaigns/store'
import { useCharacterStore } from '@features/characters/store'
import { useFactionStore } from '../store'

function makeRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { template: '<div />' } },
      { path: '/campaigns', component: { template: '<div />' } },
      { path: '/campaigns/:campaignId', component: { template: '<div />' } },
      { path: '/campaigns/:campaignId/factions', component: { template: '<div />' } },
      { path: '/campaigns/:campaignId/factions/:id', component: FactionDetailPage },
      { path: '/campaigns/:campaignId/factions/:id/edit', component: { template: '<div />' } },
      { path: '/campaigns/:campaignId/characters/:id', component: { template: '<div />' } },
    ],
  })
}

describe('FactionDetailPage', () => {
  let router: Router

  beforeEach(async () => {
    setActivePinia(createPinia())
    window.localStorage.clear()
    router = makeRouter()
  })

  it('shows not-found when missing', async () => {
    const cStore = useCampaignStore()
    const c = cStore.create({ name: 'X' })
    await router.push(`/campaigns/${c.id}/factions/fac_MISSING000`)
    await router.isReady()
    const w = mount(FactionDetailPage, { global: { plugins: [router] } })
    expect(w.text()).toContain('Not found')
  })

  it('shows faction summary when present', async () => {
    const cStore = useCampaignStore()
    const fStore = useFactionStore()
    const c = cStore.create({ name: 'X' })
    const f = fStore.create({ campaignId: c.id, name: 'Iron Hand', alignment: 'good', scope: 'national', influence: 60 })
    await router.push(`/campaigns/${c.id}/factions/${f.id}`)
    await router.isReady()
    const w = mount(FactionDetailPage, { global: { plugins: [router] } })
    expect(w.text()).toContain('Iron Hand')
    expect(w.text()).toContain('National')
    expect(w.text()).toContain('60 / 100')
  })

  it('adjusts influence via the +/- buttons', async () => {
    const cStore = useCampaignStore()
    const fStore = useFactionStore()
    const c = cStore.create({ name: 'X' })
    const f = fStore.create({ campaignId: c.id, name: 'X', influence: 30 })
    await router.push(`/campaigns/${c.id}/factions/${f.id}`)
    await router.isReady()
    const w = mount(FactionDetailPage, { global: { plugins: [router] } })
    const plus10 = w.findAll('button').find((b) => b.text() === '+10')
    await plus10!.trigger('click')
    expect(fStore.byId(f.id)?.influence).toBe(40)
  })

  it('toggles active state', async () => {
    const cStore = useCampaignStore()
    const fStore = useFactionStore()
    const c = cStore.create({ name: 'X' })
    const f = fStore.create({ campaignId: c.id, name: 'X' })
    await router.push(`/campaigns/${c.id}/factions/${f.id}`)
    await router.isReady()
    const w = mount(FactionDetailPage, { global: { plugins: [router] } })
    const dormant = w.findAll('button').find((b) => b.text() === 'Mark dormant')
    await dormant!.trigger('click')
    expect(fStore.byId(f.id)?.active).toBe(false)
  })

  it('renders a link to the leader character when present', async () => {
    const cStore = useCampaignStore()
    const fStore = useFactionStore()
    const chStore = useCharacterStore()
    const c = cStore.create({ name: 'X' })
    const leader = chStore.create({ campaignId: c.id, name: 'Maris' })
    const f = fStore.create({ campaignId: c.id, name: 'X', leaderId: leader.id })
    await router.push(`/campaigns/${c.id}/factions/${f.id}`)
    await router.isReady()
    const w = mount(FactionDetailPage, { global: { plugins: [router] } })
    expect(w.text()).toContain('Maris')
  })

  it('delete with confirm removes and routes to list', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const cStore = useCampaignStore()
    const fStore = useFactionStore()
    const c = cStore.create({ name: 'X' })
    const f = fStore.create({ campaignId: c.id, name: 'X' })
    await router.push(`/campaigns/${c.id}/factions/${f.id}`)
    await router.isReady()
    const w = mount(FactionDetailPage, { global: { plugins: [router] } })
    const del = w.findAll('button').find((b) => b.text() === 'Remove')
    await del!.trigger('click')
    await flushPromises()
    expect(fStore.byId(f.id)).toBe(null)
    expect(router.currentRoute.value.path).toBe(`/campaigns/${c.id}/factions`)
    confirmSpy.mockRestore()
  })
})
