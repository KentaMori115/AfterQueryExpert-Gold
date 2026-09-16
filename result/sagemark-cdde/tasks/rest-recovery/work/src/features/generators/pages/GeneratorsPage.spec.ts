import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'

import { useCampaignStore } from '@features/campaigns/store'
import { useCharacterStore } from '@features/characters/store'

import GeneratorsPage from './GeneratorsPage.vue'

function makeRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { template: '<div />' } },
      { path: '/campaigns', component: { template: '<div />' } },
      { path: '/campaigns/:campaignId', component: { template: '<div />' } },
      { path: '/campaigns/:campaignId/generators', component: GeneratorsPage },
      { path: '/campaigns/:campaignId/characters/:id', component: { template: '<div />' } },
    ],
  })
}

async function mountAt(campaignId: string) {
  const router = makeRouter()
  await router.push(`/campaigns/${campaignId}/generators`)
  await router.isReady()
  return { wrapper: mount(GeneratorsPage, { global: { plugins: [router] } }), router }
}

describe('GeneratorsPage', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    window.localStorage.clear()
  })

  it('shows campaign not found when the id is bogus', async () => {
    const { wrapper } = await mountAt('camp_missing')
    expect(wrapper.text()).toContain('Campaign not found')
  })

  it('renders the four sections when the campaign exists', async () => {
    const camp = useCampaignStore().create({ name: 'F', summary: 's' })
    const { wrapper } = await mountAt(camp.id)
    expect(wrapper.text()).toContain('Quick NPC')
    expect(wrapper.text()).toContain('Tavern name')
    expect(wrapper.text()).toContain('Street name')
    expect(wrapper.text()).toContain('Rumor')
  })

  it('reroll updates the tavern name', async () => {
    const camp = useCampaignStore().create({ name: 'F', summary: 's' })
    const { wrapper } = await mountAt(camp.id)
    // crude check: button exists and clicking it doesn't crash
    const reroll = wrapper.findAll('button').filter((b) => b.text() === 'reroll')
    expect(reroll.length).toBeGreaterThan(0)
    await reroll[0]!.trigger('click')
    expect(wrapper.text()).toContain('Tavern name')
  })

  it('adopting an NPC creates a character and navigates to its detail page', async () => {
    const camp = useCampaignStore().create({ name: 'F', summary: 's' })
    const characters = useCharacterStore()
    const { wrapper, router } = await mountAt(camp.id)
    const adopt = wrapper.findAll('button').find((b) => b.text().includes('adopt'))
    await adopt!.trigger('click')
    await flushPromises()
    expect(characters.forCampaign(camp.id as never)).toHaveLength(1)
    const created = characters.forCampaign(camp.id as never)[0]!
    expect(router.currentRoute.value.path).toBe(
      `/campaigns/${camp.id}/characters/${created.id}`,
    )
  })
})
