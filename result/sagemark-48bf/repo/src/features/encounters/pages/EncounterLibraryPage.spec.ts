import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'

import { useCampaignStore } from '@features/campaigns/store'
import { useEncounterStore } from '../store'

import EncounterLibraryPage from './EncounterLibraryPage.vue'

function makeRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { template: '<div />' } },
      { path: '/campaigns', component: { template: '<div />' } },
      { path: '/campaigns/:campaignId', component: { template: '<div />' } },
      { path: '/campaigns/:campaignId/encounters', component: { template: '<div />' } },
      { path: '/campaigns/:campaignId/encounters/library', component: EncounterLibraryPage },
      { path: '/campaigns/:campaignId/encounters/:id', component: { template: '<div />' } },
    ],
  })
}

async function mountAt(campaignId: string) {
  const router = makeRouter()
  await router.push(`/campaigns/${campaignId}/encounters/library`)
  await router.isReady()
  return { wrapper: mount(EncounterLibraryPage, { global: { plugins: [router] } }), router }
}

describe('EncounterLibraryPage', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    window.localStorage.clear()
  })

  it('shows campaign not found for a bogus id', async () => {
    const { wrapper } = await mountAt('camp_missing')
    expect(wrapper.text()).toContain('Campaign not found')
  })

  it('lists the preset templates by default', async () => {
    const camp = useCampaignStore().create({ name: 'F' })
    const { wrapper } = await mountAt(camp.id)
    expect(wrapper.text()).toContain('Goblin trail ambush')
    expect(wrapper.text()).toContain('Frost giant on the ridge')
  })

  it('level filter narrows the list', async () => {
    const camp = useCampaignStore().create({ name: 'F' })
    const { wrapper } = await mountAt(camp.id)
    await wrapper.find('#library-level').setValue(1)
    expect(wrapper.text()).toContain('Goblin trail ambush')
    expect(wrapper.text()).not.toContain('Frost giant')
  })

  it('role filter narrows to templates that include the role', async () => {
    const camp = useCampaignStore().create({ name: 'F' })
    const { wrapper } = await mountAt(camp.id)
    await wrapper.find('#library-role').setValue('boss')
    expect(wrapper.text()).toContain('Frost giant')
    expect(wrapper.text()).not.toContain('Goblin trail ambush')
  })

  it('adopt button creates an encounter and navigates to it', async () => {
    const camp = useCampaignStore().create({ name: 'F' })
    const { wrapper, router } = await mountAt(camp.id)
    const adopt = wrapper.findAll('button').find((b) => b.text() === 'adopt')
    await adopt!.trigger('click')
    await flushPromises()
    const encounters = useEncounterStore()
    expect(encounters.forCampaign(camp.id as never).length).toBeGreaterThan(0)
    expect(router.currentRoute.value.path).toContain('/encounters/')
  })
})
