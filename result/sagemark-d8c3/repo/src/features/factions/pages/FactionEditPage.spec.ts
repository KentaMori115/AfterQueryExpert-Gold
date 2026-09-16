import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'

import FactionEditPage from './FactionEditPage.vue'
import { useCampaignStore } from '@features/campaigns/store'
import { useFactionStore } from '../store'

function makeRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { template: '<div />' } },
      { path: '/campaigns', component: { template: '<div />' } },
      { path: '/campaigns/:campaignId', component: { template: '<div />' } },
      { path: '/campaigns/:campaignId/factions', component: { template: '<div />' } },
      { path: '/campaigns/:campaignId/factions/:id', component: { template: '<div />' } },
      { path: '/campaigns/:campaignId/factions/:id/edit', component: FactionEditPage },
    ],
  })
}

describe('FactionEditPage', () => {
  let router: Router

  beforeEach(async () => {
    setActivePinia(createPinia())
    window.localStorage.clear()
    router = makeRouter()
  })

  it('shows not-found for missing faction', async () => {
    const cStore = useCampaignStore()
    const c = cStore.create({ name: 'X' })
    await router.push(`/campaigns/${c.id}/factions/fac_MISSING/edit`)
    await router.isReady()
    const w = mount(FactionEditPage, { global: { plugins: [router] } })
    expect(w.text()).toContain('Not found')
  })

  it('seeds the form with the current faction values', async () => {
    const cStore = useCampaignStore()
    const fStore = useFactionStore()
    const c = cStore.create({ name: 'X' })
    const f = fStore.create({ campaignId: c.id, name: 'Old', alignment: 'good', influence: 80 })
    await router.push(`/campaigns/${c.id}/factions/${f.id}/edit`)
    await router.isReady()
    const w = mount(FactionEditPage, { global: { plugins: [router] } })
    expect((w.get('#faction-name').element as HTMLInputElement).value).toBe('Old')
    expect((w.get('#faction-alignment').element as HTMLSelectElement).value).toBe('good')
  })

  it('saves and routes back to detail', async () => {
    const cStore = useCampaignStore()
    const fStore = useFactionStore()
    const c = cStore.create({ name: 'X' })
    const f = fStore.create({ campaignId: c.id, name: 'Old' })
    await router.push(`/campaigns/${c.id}/factions/${f.id}/edit`)
    await router.isReady()
    const w = mount(FactionEditPage, { global: { plugins: [router] } })
    await w.get('#faction-name').setValue('Renamed')
    await w.find('form').trigger('submit.prevent')
    await flushPromises()
    expect(fStore.byId(f.id)?.name).toBe('Renamed')
    expect(router.currentRoute.value.path).toBe(`/campaigns/${c.id}/factions/${f.id}`)
  })

  it('discard keeps the faction unchanged', async () => {
    const cStore = useCampaignStore()
    const fStore = useFactionStore()
    const c = cStore.create({ name: 'X' })
    const f = fStore.create({ campaignId: c.id, name: 'Old' })
    await router.push(`/campaigns/${c.id}/factions/${f.id}/edit`)
    await router.isReady()
    const w = mount(FactionEditPage, { global: { plugins: [router] } })
    await w.get('#faction-name').setValue('Junk')
    const cancel = w.findAll('button').find((b) => b.text() === 'Discard')
    await cancel!.trigger('click')
    await flushPromises()
    expect(fStore.byId(f.id)?.name).toBe('Old')
  })
})
