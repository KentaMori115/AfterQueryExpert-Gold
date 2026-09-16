import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'

import CharactersListPage from './CharactersListPage.vue'
import { useCampaignStore } from '@features/campaigns/store'
import { useCharacterStore } from '../store'

function makeRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { template: '<div />' } },
      { path: '/campaigns', component: { template: '<div />' } },
      { path: '/campaigns/:campaignId', component: { template: '<div />' } },
      { path: '/campaigns/:campaignId/characters', component: CharactersListPage },
      { path: '/campaigns/:campaignId/characters/new', component: { template: '<div />' } },
      { path: '/campaigns/:campaignId/characters/:id', component: { template: '<div />' } },
    ],
  })
}

describe('CharactersListPage', () => {
  let router: Router

  beforeEach(async () => {
    setActivePinia(createPinia())
    window.localStorage.clear()
    router = makeRouter()
  })

  it('shows not-found when the campaign id is bogus', async () => {
    await router.push('/campaigns/camp_MISSING/characters')
    await router.isReady()
    const w = mount(CharactersListPage, { global: { plugins: [router] } })
    expect(w.text()).toContain('Campaign not found')
  })

  it('shows the empty state when no characters exist', async () => {
    const campStore = useCampaignStore()
    const c = campStore.create({ name: 'Frozen Gate' })
    await router.push(`/campaigns/${c.id}/characters`)
    await router.isReady()
    const w = mount(CharactersListPage, { global: { plugins: [router] } })
    expect(w.text()).toContain('No one is on the page yet')
  })

  it('partitions pcs and npcs under headings', async () => {
    const campStore = useCampaignStore()
    const chStore = useCharacterStore()
    const c = campStore.create({ name: 'X' })
    chStore.create({ campaignId: c.id, name: 'Iris', kind: 'pc' })
    chStore.create({ campaignId: c.id, name: 'Kael', kind: 'npc' })
    await router.push(`/campaigns/${c.id}/characters`)
    await router.isReady()
    const w = mount(CharactersListPage, { global: { plugins: [router] } })
    expect(w.text()).toContain('The party')
    expect(w.text()).toContain('Everyone else')
    expect(w.text()).toContain('Iris')
    expect(w.text()).toContain('Kael')
  })

  it('reports the players/non-players meta', async () => {
    const campStore = useCampaignStore()
    const chStore = useCharacterStore()
    const c = campStore.create({ name: 'X' })
    chStore.create({ campaignId: c.id, name: 'A', kind: 'pc' })
    chStore.create({ campaignId: c.id, name: 'B', kind: 'pc' })
    chStore.create({ campaignId: c.id, name: 'C', kind: 'npc' })
    await router.push(`/campaigns/${c.id}/characters`)
    await router.isReady()
    const w = mount(CharactersListPage, { global: { plugins: [router] } })
    expect(w.text()).toContain('2 players / 1 non-players')
  })

  it('paginates the npc grid past 18 entries', async () => {
    const campStore = useCampaignStore()
    const chStore = useCharacterStore()
    const c = campStore.create({ name: 'X' })
    for (let i = 0; i < 25; i++) {
      chStore.create({ campaignId: c.id, name: `npc${i}`, kind: 'npc' })
    }
    await router.push(`/campaigns/${c.id}/characters`)
    await router.isReady()
    const w = mount(CharactersListPage, { global: { plugins: [router] } })
    // Should render 18 npc cards on page 1
    const npcSection = w.findAll('section')[1]
    expect(npcSection?.findAll('li')).toHaveLength(18)
  })
})
