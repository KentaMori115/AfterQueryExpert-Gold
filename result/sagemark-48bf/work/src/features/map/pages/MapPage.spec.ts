import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'

import { useCampaignStore } from '@features/campaigns/store'
import { useLocationStore } from '@features/locations/store'

import { useMapStore } from '../store'

import MapPage from './MapPage.vue'

function makeRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { template: '<div />' } },
      { path: '/campaigns', component: { template: '<div />' } },
      { path: '/campaigns/:campaignId', component: { template: '<div />' } },
      { path: '/campaigns/:campaignId/locations/:id', component: { template: '<div />' } },
      { path: '/campaigns/:campaignId/map', component: MapPage },
    ],
  })
}

async function mountAt(campaignId: string) {
  const router = makeRouter()
  await router.push(`/campaigns/${campaignId}/map`)
  await router.isReady()
  return mount(MapPage, { global: { plugins: [router] } })
}

describe('MapPage', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    window.localStorage.clear()
  })

  it('shows campaign not found for a bogus id', async () => {
    const w = await mountAt('camp_missing')
    expect(w.text()).toContain('Campaign not found')
  })

  it('empty plot when no places are dropped', async () => {
    const camp = useCampaignStore().create({ name: 'F' })
    useLocationStore().create({ campaignId: camp.id, name: 'A', kind: 'city' })
    const w = await mountAt(camp.id)
    expect(w.text()).toContain('No places plotted yet')
  })

  it('places a location through the form', async () => {
    const camp = useCampaignStore().create({ name: 'F' })
    const loc = useLocationStore().create({ campaignId: camp.id, name: 'A', kind: 'city' })
    const w = await mountAt(camp.id)
    await w.find('#map-location').setValue(loc.id)
    await w.find('#map-x').setValue(5)
    await w.find('#map-y').setValue(10)
    await w.find('form').trigger('submit.prevent')
    expect(useMapStore().placement(camp.id as never, loc.id as never)).toEqual({
      campaignId: camp.id,
      locationId: loc.id,
      x: 5,
      y: 10,
    })
    expect(w.find('svg').exists()).toBe(true)
  })

  it('unplace removes a placed location', async () => {
    const camp = useCampaignStore().create({ name: 'F' })
    const loc = useLocationStore().create({ campaignId: camp.id, name: 'A', kind: 'city' })
    const store = useMapStore()
    store.placeAt(camp.id as never, loc.id as never, 3, 4)
    const w = await mountAt(camp.id)
    const unplace = w.findAll('button').find((b) => b.text() === 'unplace')
    await unplace!.trigger('click')
    expect(store.placement(camp.id as never, loc.id as never)).toBeNull()
  })
})
