import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'

import { useCampaignStore } from '@features/campaigns/store'

import EncounterDifficultyPage from './EncounterDifficultyPage.vue'

function makeRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { template: '<div />' } },
      { path: '/campaigns', component: { template: '<div />' } },
      { path: '/campaigns/:campaignId', component: { template: '<div />' } },
      { path: '/campaigns/:campaignId/encounters', component: { template: '<div />' } },
      { path: '/campaigns/:campaignId/encounters/bench', component: EncounterDifficultyPage },
    ],
  })
}

async function mountAt(campaignId: string) {
  const router = makeRouter()
  await router.push(`/campaigns/${campaignId}/encounters/bench`)
  await router.isReady()
  return mount(EncounterDifficultyPage, { global: { plugins: [router] } })
}

describe('EncounterDifficultyPage', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    window.localStorage.clear()
  })

  it('shows campaign not found when the id is bogus', async () => {
    const w = await mountAt('camp_missing')
    expect(w.text()).toContain('Campaign not found')
  })

  it('renders the bench title and primer when the campaign exists', async () => {
    const camp = useCampaignStore().create({ name: 'F', summary: 's' })
    const w = await mountAt(camp.id)
    expect(w.text()).toContain('Difficulty bench')
    expect(w.text()).toContain('Calculator')
    expect(w.text()).toContain('How this works')
  })

  it('embeds the calculator panel', async () => {
    const camp = useCampaignStore().create({ name: 'F', summary: 's' })
    const w = await mountAt(camp.id)
    expect(w.find('#party-size').exists()).toBe(true)
    expect(w.find('#party-level').exists()).toBe(true)
  })
})
