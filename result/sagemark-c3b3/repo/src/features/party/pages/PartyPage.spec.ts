import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'

import { useCampaignStore } from '@features/campaigns/store'
import { useCharacterStore } from '@features/characters/store'

import { usePartyStore } from '../store'

import PartyPage from './PartyPage.vue'

function makeRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { template: '<div />' } },
      { path: '/campaigns', component: { template: '<div />' } },
      { path: '/campaigns/:campaignId', component: { template: '<div />' } },
      { path: '/campaigns/:campaignId/party', component: PartyPage },
      { path: '/campaigns/:campaignId/characters/:id', component: { template: '<div />' } },
    ],
  })
}

async function mountAt(campaignId: string) {
  const router = makeRouter()
  await router.push(`/campaigns/${campaignId}/party`)
  await router.isReady()
  return mount(PartyPage, { global: { plugins: [router] } })
}

describe('PartyPage', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    window.localStorage.clear()
  })

  it('shows campaign not found for a bogus id', async () => {
    const w = await mountAt('camp_missing')
    expect(w.text()).toContain('Campaign not found')
  })

  it('renders empty state with no members', async () => {
    const camp = useCampaignStore().create({ name: 'F' })
    const characters = useCharacterStore()
    characters.create({ campaignId: camp.id, name: 'Iris', kind: 'pc' })
    const w = await mountAt(camp.id)
    expect(w.text()).toContain('No members yet')
  })

  it('adds a member via the available pool', async () => {
    const camp = useCampaignStore().create({ name: 'F' })
    const characters = useCharacterStore()
    characters.create({ campaignId: camp.id, name: 'Iris', kind: 'pc' })
    const w = await mountAt(camp.id)
    const add = w.findAll('button').find((b) => b.text() === 'Iris')
    await add!.trigger('click')
    expect(usePartyStore().getParty(camp.id as never).members).toHaveLength(1)
  })

  it('setStatus through the button row', async () => {
    const camp = useCampaignStore().create({ name: 'F' })
    const characters = useCharacterStore()
    const ch = characters.create({ campaignId: camp.id, name: 'Iris', kind: 'pc' })
    const party = usePartyStore()
    party.addMember(camp.id as never, ch.id)
    const w = await mountAt(camp.id)
    const benched = w.findAll('button').find((b) => b.text() === 'benched')
    await benched!.trigger('click')
    expect(party.getParty(camp.id as never).members[0]!.status).toBe('benched')
  })

  it('motto input saves on change', async () => {
    const camp = useCampaignStore().create({ name: 'F' })
    const w = await mountAt(camp.id)
    const motto = w.find('#party-motto')
    await motto.setValue('no one stands alone')
    await motto.trigger('change')
    expect(usePartyStore().getParty(camp.id as never).motto).toBe('no one stands alone')
  })
})
