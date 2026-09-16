import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'

import { useCampaignStore } from '@features/campaigns/store'
import { useCharacterStore } from '@features/characters/store'

import { useDowntimeStore } from '../store'

import DowntimePage from './DowntimePage.vue'

function makeRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { template: '<div />' } },
      { path: '/campaigns', component: { template: '<div />' } },
      { path: '/campaigns/:campaignId', component: { template: '<div />' } },
      { path: '/campaigns/:campaignId/downtime', component: DowntimePage },
    ],
  })
}

async function mountAt(campaignId: string) {
  const router = makeRouter()
  await router.push(`/campaigns/${campaignId}/downtime`)
  await router.isReady()
  return mount(DowntimePage, { global: { plugins: [router] } })
}

describe('DowntimePage', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    window.localStorage.clear()
  })

  it('shows campaign not found for a bogus id', async () => {
    const w = await mountAt('camp_missing')
    expect(w.text()).toContain('Campaign not found')
  })

  it('renders the empty state when no activities are logged', async () => {
    const camp = useCampaignStore().create({ name: 'F', summary: 's' })
    const w = await mountAt(camp.id)
    expect(w.text()).toContain('No downtime logged')
  })

  it('rejects logging without a character', async () => {
    const camp = useCampaignStore().create({ name: 'F', summary: 's' })
    const w = await mountAt(camp.id)
    await w.find('form').trigger('submit.prevent')
    expect(w.text()).toContain('pick a character first')
  })

  it('logs an activity through the form', async () => {
    const camp = useCampaignStore().create({ name: 'F', summary: 's' })
    const characters = useCharacterStore()
    const char = characters.create({ campaignId: camp.id, name: 'Iris', kind: 'pc' })
    const w = await mountAt(camp.id)
    const selects = w.findAll('select')
    await selects[0]!.setValue(char.id)
    await selects[1]!.setValue('training')
    await w.find('textarea').setValue('drill the parry')
    await w.find('form').trigger('submit.prevent')
    const store = useDowntimeStore()
    expect(store.forCampaign(camp.id as never)).toHaveLength(1)
    expect(w.text()).toContain('drill the parry')
  })

  it('switches outcome via the outcome buttons', async () => {
    const camp = useCampaignStore().create({ name: 'F', summary: 's' })
    const characters = useCharacterStore()
    const char = characters.create({ campaignId: camp.id, name: 'Iris', kind: 'pc' })
    const store = useDowntimeStore()
    const a = store.create({ campaignId: camp.id as never, characterId: char.id, kind: 'training' })
    const w = await mountAt(camp.id)
    const underway = w.findAll('button').find((b) => b.text() === 'underway')
    expect(underway).toBeTruthy()
    await underway!.trigger('click')
    expect(store.byId(a.id)?.outcome).toBe('underway')
  })
})
