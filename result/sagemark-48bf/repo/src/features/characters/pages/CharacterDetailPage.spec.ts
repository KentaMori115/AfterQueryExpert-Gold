import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'

import CharacterDetailPage from './CharacterDetailPage.vue'
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
      { path: '/campaigns/:campaignId/characters/:id', component: CharacterDetailPage },
      { path: '/campaigns/:campaignId/characters/:id/edit', component: { template: '<div />' } },
    ],
  })
}

describe('CharacterDetailPage', () => {
  let router: Router

  beforeEach(async () => {
    setActivePinia(createPinia())
    window.localStorage.clear()
    router = makeRouter()
  })

  it('shows not-found when the character id is wrong', async () => {
    const campStore = useCampaignStore()
    const c = campStore.create({ name: 'X' })
    await router.push(`/campaigns/${c.id}/characters/char_MISSING000`)
    await router.isReady()
    const w = mount(CharacterDetailPage, { global: { plugins: [router] } })
    expect(w.text()).toContain('Not found')
  })

  it('renders the character details when present', async () => {
    const campStore = useCampaignStore()
    const chStore = useCharacterStore()
    const c = campStore.create({ name: 'X' })
    const ch = chStore.create({
      campaignId: c.id,
      name: 'Iris',
      kind: 'pc',
      ancestry: 'human',
      vocation: 'warden',
      level: 5,
    })
    await router.push(`/campaigns/${c.id}/characters/${ch.id}`)
    await router.isReady()
    const w = mount(CharacterDetailPage, { global: { plugins: [router] } })
    expect(w.text()).toContain('Iris')
    expect(w.text()).toContain('human')
    expect(w.text()).toContain('warden')
  })

  it('changes disposition when a disposition button is clicked', async () => {
    const campStore = useCampaignStore()
    const chStore = useCharacterStore()
    const c = campStore.create({ name: 'X' })
    const ch = chStore.create({ campaignId: c.id, name: 'Iris' })
    await router.push(`/campaigns/${c.id}/characters/${ch.id}`)
    await router.isReady()
    const w = mount(CharacterDetailPage, { global: { plugins: [router] } })
    const hostileBtn = w.findAll('button').find((b) => b.text() === 'Hostile')
    await hostileBtn!.trigger('click')
    expect(chStore.byId(ch.id)?.disposition).toBe('hostile')
  })

  it('toggles alive via the mark-fallen button', async () => {
    const campStore = useCampaignStore()
    const chStore = useCharacterStore()
    const c = campStore.create({ name: 'X' })
    const ch = chStore.create({ campaignId: c.id, name: 'Iris' })
    await router.push(`/campaigns/${c.id}/characters/${ch.id}`)
    await router.isReady()
    const w = mount(CharacterDetailPage, { global: { plugins: [router] } })
    const fallenBtn = w.findAll('button').find((b) => b.text() === 'Mark fallen')
    await fallenBtn!.trigger('click')
    expect(chStore.byId(ch.id)?.alive).toBe(false)
  })

  it('delete with confirm removes and routes to the list', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const campStore = useCampaignStore()
    const chStore = useCharacterStore()
    const c = campStore.create({ name: 'X' })
    const ch = chStore.create({ campaignId: c.id, name: 'Iris' })
    await router.push(`/campaigns/${c.id}/characters/${ch.id}`)
    await router.isReady()
    const w = mount(CharacterDetailPage, { global: { plugins: [router] } })
    const del = w.findAll('button').find((b) => b.text() === 'Remove from cast')
    await del!.trigger('click')
    await flushPromises()
    expect(chStore.byId(ch.id)).toBe(null)
    expect(router.currentRoute.value.path).toBe(`/campaigns/${c.id}/characters`)
    confirmSpy.mockRestore()
  })

  it('delete cancelled keeps the character', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const campStore = useCampaignStore()
    const chStore = useCharacterStore()
    const c = campStore.create({ name: 'X' })
    const ch = chStore.create({ campaignId: c.id, name: 'Iris' })
    await router.push(`/campaigns/${c.id}/characters/${ch.id}`)
    await router.isReady()
    const w = mount(CharacterDetailPage, { global: { plugins: [router] } })
    const del = w.findAll('button').find((b) => b.text() === 'Remove from cast')
    await del!.trigger('click')
    expect(chStore.byId(ch.id)).not.toBe(null)
    confirmSpy.mockRestore()
  })
})
