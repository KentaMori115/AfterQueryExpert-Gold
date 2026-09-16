import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'

import CharacterEditPage from './CharacterEditPage.vue'
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
      { path: '/campaigns/:campaignId/characters/:id', component: { template: '<div />' } },
      { path: '/campaigns/:campaignId/characters/:id/edit', component: CharacterEditPage },
    ],
  })
}

describe('CharacterEditPage', () => {
  let router: Router

  beforeEach(async () => {
    setActivePinia(createPinia())
    window.localStorage.clear()
    router = makeRouter()
  })

  it('shows not-found for missing character', async () => {
    const campStore = useCampaignStore()
    const c = campStore.create({ name: 'X' })
    await router.push(`/campaigns/${c.id}/characters/char_MISSING/edit`)
    await router.isReady()
    const w = mount(CharacterEditPage, { global: { plugins: [router] } })
    expect(w.text()).toContain('Not found')
  })

  it('seeds the form with current values', async () => {
    const campStore = useCampaignStore()
    const chStore = useCharacterStore()
    const c = campStore.create({ name: 'X' })
    const ch = chStore.create({ campaignId: c.id, name: 'Old name', ancestry: 'elf', level: 8 })
    await router.push(`/campaigns/${c.id}/characters/${ch.id}/edit`)
    await router.isReady()
    const w = mount(CharacterEditPage, { global: { plugins: [router] } })
    expect((w.get('#character-name').element as HTMLInputElement).value).toBe('Old name')
    expect((w.get('#character-ancestry').element as HTMLInputElement).value).toBe('elf')
    expect((w.get('#character-level').element as HTMLInputElement).value).toBe('8')
  })

  it('saves changes and routes back to detail', async () => {
    const campStore = useCampaignStore()
    const chStore = useCharacterStore()
    const c = campStore.create({ name: 'X' })
    const ch = chStore.create({ campaignId: c.id, name: 'Old' })
    await router.push(`/campaigns/${c.id}/characters/${ch.id}/edit`)
    await router.isReady()
    const w = mount(CharacterEditPage, { global: { plugins: [router] } })
    await w.get('#character-name').setValue('Renamed')
    await w.find('form').trigger('submit.prevent')
    await flushPromises()
    expect(chStore.byId(ch.id)?.name).toBe('Renamed')
    expect(router.currentRoute.value.path).toBe(`/campaigns/${c.id}/characters/${ch.id}`)
  })

  it('discard routes back to detail without saving', async () => {
    const campStore = useCampaignStore()
    const chStore = useCharacterStore()
    const c = campStore.create({ name: 'X' })
    const ch = chStore.create({ campaignId: c.id, name: 'Old' })
    await router.push(`/campaigns/${c.id}/characters/${ch.id}/edit`)
    await router.isReady()
    const w = mount(CharacterEditPage, { global: { plugins: [router] } })
    await w.get('#character-name').setValue('Junk')
    const cancel = w.findAll('button').find((b) => b.text() === 'Discard')
    await cancel!.trigger('click')
    await flushPromises()
    expect(chStore.byId(ch.id)?.name).toBe('Old')
    expect(router.currentRoute.value.path).toBe(`/campaigns/${c.id}/characters/${ch.id}`)
  })
})
