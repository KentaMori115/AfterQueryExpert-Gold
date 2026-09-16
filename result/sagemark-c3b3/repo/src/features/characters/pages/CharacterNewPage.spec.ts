import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'

import CharacterNewPage from './CharacterNewPage.vue'
import { useCampaignStore } from '@features/campaigns/store'
import { useCharacterStore } from '../store'

function makeRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { template: '<div />' } },
      { path: '/campaigns', component: { template: '<div />' } },
      { path: '/campaigns/:campaignId', component: { template: '<div />' } },
      { path: '/campaigns/:campaignId/characters', component: { template: '<div />' } },
      { path: '/campaigns/:campaignId/characters/new', component: CharacterNewPage },
      { path: '/campaigns/:campaignId/characters/:id', component: { template: '<div />' } },
    ],
  })
}

describe('CharacterNewPage', () => {
  let router: Router

  beforeEach(async () => {
    setActivePinia(createPinia())
    window.localStorage.clear()
    router = makeRouter()
  })

  it('shows not-found when campaign is missing', async () => {
    await router.push('/campaigns/camp_MISSING/characters/new')
    await router.isReady()
    const w = mount(CharacterNewPage, { global: { plugins: [router] } })
    expect(w.text()).toContain('Campaign not found')
  })

  it('creates a character and routes to its detail', async () => {
    const campStore = useCampaignStore()
    const chStore = useCharacterStore()
    const c = campStore.create({ name: 'X' })
    await router.push(`/campaigns/${c.id}/characters/new`)
    await router.isReady()
    const w = mount(CharacterNewPage, { global: { plugins: [router] } })
    await w.get('#character-name').setValue('Brann')
    await w.find('form').trigger('submit.prevent')
    await flushPromises()
    expect(chStore.forCampaign(c.id)).toHaveLength(1)
    const created = chStore.forCampaign(c.id)[0]!
    expect(router.currentRoute.value.path).toBe(`/campaigns/${c.id}/characters/${created.id}`)
  })

  it('does not create when validation fails', async () => {
    const campStore = useCampaignStore()
    const chStore = useCharacterStore()
    const c = campStore.create({ name: 'X' })
    await router.push(`/campaigns/${c.id}/characters/new`)
    await router.isReady()
    const w = mount(CharacterNewPage, { global: { plugins: [router] } })
    await w.find('form').trigger('submit.prevent')
    expect(chStore.forCampaign(c.id)).toHaveLength(0)
  })

  it('cancel routes back to the character list', async () => {
    const campStore = useCampaignStore()
    const c = campStore.create({ name: 'X' })
    await router.push(`/campaigns/${c.id}/characters/new`)
    await router.isReady()
    const w = mount(CharacterNewPage, { global: { plugins: [router] } })
    const back = w.findAll('button').find((b) => b.text() === 'Back')
    await back!.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe(`/campaigns/${c.id}/characters`)
  })
})
