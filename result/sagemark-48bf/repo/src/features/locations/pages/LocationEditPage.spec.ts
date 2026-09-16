import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'

import LocationEditPage from './LocationEditPage.vue'
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
      { path: '/campaigns/:campaignId/locations/:id', component: { template: '<div />' } },
      { path: '/campaigns/:campaignId/locations/:id/edit', component: LocationEditPage },
    ],
  })
}

describe('LocationEditPage', () => {
  let router: Router

  beforeEach(async () => {
    setActivePinia(createPinia())
    window.localStorage.clear()
    router = makeRouter()
  })

  it('not-found for missing', async () => {
    const cStore = useCampaignStore()
    const c = cStore.create({ name: 'X' })
    await router.push(`/campaigns/${c.id}/locations/loc_MISSING/edit`)
    await router.isReady()
    const w = mount(LocationEditPage, { global: { plugins: [router] } })
    expect(w.text()).toContain('Not found')
  })

  it('seeds the form with current values', async () => {
    const cStore = useCampaignStore()
    const lStore = useLocationStore()
    const c = cStore.create({ name: 'X' })
    const l = lStore.create({ campaignId: c.id, name: 'Old', kind: 'city', notes: 'snug' })
    await router.push(`/campaigns/${c.id}/locations/${l.id}/edit`)
    await router.isReady()
    const w = mount(LocationEditPage, { global: { plugins: [router] } })
    expect((w.get('#location-name').element as HTMLInputElement).value).toBe('Old')
    expect((w.get('#location-kind').element as HTMLSelectElement).value).toBe('city')
  })

  it('saves and routes back to detail', async () => {
    const cStore = useCampaignStore()
    const lStore = useLocationStore()
    const c = cStore.create({ name: 'X' })
    const l = lStore.create({ campaignId: c.id, name: 'Old' })
    await router.push(`/campaigns/${c.id}/locations/${l.id}/edit`)
    await router.isReady()
    const w = mount(LocationEditPage, { global: { plugins: [router] } })
    await w.get('#location-name').setValue('Renamed')
    await w.find('form').trigger('submit.prevent')
    await flushPromises()
    expect(lStore.byId(l.id)?.name).toBe('Renamed')
    expect(router.currentRoute.value.path).toBe(`/campaigns/${c.id}/locations/${l.id}`)
  })

  it('forbids self as parent in the dropdown', async () => {
    const cStore = useCampaignStore()
    const lStore = useLocationStore()
    const c = cStore.create({ name: 'X' })
    const a = lStore.create({ campaignId: c.id, name: 'A' })
    const b = lStore.create({ campaignId: c.id, name: 'B' })
    await router.push(`/campaigns/${c.id}/locations/${a.id}/edit`)
    await router.isReady()
    const w = mount(LocationEditPage, { global: { plugins: [router] } })
    const parentSelect = w.get('#location-parent')
    const options = parentSelect.findAll('option')
    const names = options.map((o) => o.text())
    expect(names).not.toContain('A')
    expect(names).toContain('B')
  })
})
