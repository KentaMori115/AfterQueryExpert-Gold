import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'

import { useCampaignStore } from '@features/campaigns/store'
import { useCharacterStore } from '@features/characters/store'

import { useTagStore } from '../store'

import TagBrowsePage from './TagBrowsePage.vue'

function makeRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { template: '<div />' } },
      { path: '/campaigns', component: { template: '<div />' } },
      { path: '/campaigns/:campaignId', component: { template: '<div />' } },
      { path: '/campaigns/:campaignId/tags', component: { template: '<div />' } },
      { path: '/campaigns/:campaignId/tags/browse', component: TagBrowsePage },
      { path: '/campaigns/:campaignId/characters/:id', component: { template: '<div />' } },
    ],
  })
}

async function mountAt(campaignId: string) {
  const router = makeRouter()
  await router.push(`/campaigns/${campaignId}/tags/browse`)
  await router.isReady()
  return mount(TagBrowsePage, { global: { plugins: [router] } })
}

describe('TagBrowsePage', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    window.localStorage.clear()
  })

  it('shows campaign not found when the id is bogus', async () => {
    const w = await mountAt('camp_missing')
    expect(w.text()).toContain('Campaign not found')
  })

  it('prompts to mint tags when the campaign has none', async () => {
    const camp = useCampaignStore().create({ name: 'F', summary: 's' })
    const w = await mountAt(camp.id)
    expect(w.text()).toContain('No tags yet')
  })

  it('shows the nothing picked empty state until a tag is selected', async () => {
    const camp = useCampaignStore().create({ name: 'F', summary: 's' })
    useTagStore().create({ campaignId: camp.id as never, name: 'Iron' })
    const w = await mountAt(camp.id)
    expect(w.text()).toContain('Nothing picked')
  })

  it('lists targets after a tag chip is clicked', async () => {
    const campaigns = useCampaignStore()
    const tags = useTagStore()
    const characters = useCharacterStore()
    const camp = campaigns.create({ name: 'F', summary: 's' })
    const char = characters.create({ campaignId: camp.id, name: 'Iris', kind: 'pc' })
    const tag = tags.create({ campaignId: camp.id as never, name: 'Iron' })
    tags.attach(tag.id, 'character', char.id)
    const w = await mountAt(camp.id)
    const button = w
      .findAll('button')
      .find((b) => b.attributes('aria-pressed') !== undefined && b.text().includes('Iron'))
    expect(button).toBeTruthy()
    await button!.trigger('click')
    expect(w.text()).toContain('Iris')
    expect(w.text()).toContain('Cast')
  })

  it('clear button resets the selection', async () => {
    const campaigns = useCampaignStore()
    const tags = useTagStore()
    const camp = campaigns.create({ name: 'F', summary: 's' })
    const tag = tags.create({ campaignId: camp.id as never, name: 'Iron' })
    void tag
    const w = await mountAt(camp.id)
    const pick = w
      .findAll('button')
      .find((b) => b.attributes('aria-pressed') !== undefined && b.text().includes('Iron'))
    await pick!.trigger('click')
    const clear = w.findAll('button').find((b) => b.text() === 'clear')
    expect(clear).toBeTruthy()
    await clear!.trigger('click')
    expect(w.text()).toContain('Nothing picked')
  })
})
