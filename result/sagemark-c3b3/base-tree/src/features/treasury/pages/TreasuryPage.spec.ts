import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'

import { useCampaignStore } from '@features/campaigns/store'

import { useTreasuryStore } from '../store'

import TreasuryPage from './TreasuryPage.vue'

function makeRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { template: '<div />' } },
      { path: '/campaigns', component: { template: '<div />' } },
      { path: '/campaigns/:campaignId', component: { template: '<div />' } },
      { path: '/campaigns/:campaignId/treasury', component: TreasuryPage },
    ],
  })
}

async function mountAt(campaignId: string) {
  const router = makeRouter()
  await router.push(`/campaigns/${campaignId}/treasury`)
  await router.isReady()
  return mount(TreasuryPage, { global: { plugins: [router] } })
}

describe('TreasuryPage', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    window.localStorage.clear()
  })

  it('shows campaign not found for a bogus id', async () => {
    const w = await mountAt('camp_missing')
    expect(w.text()).toContain('Campaign not found')
  })

  it('renders the empty state when no movements are logged', async () => {
    const camp = useCampaignStore().create({ name: 'F' })
    const w = await mountAt(camp.id)
    expect(w.text()).toContain('No movements yet')
  })

  it('rejects an empty move with a hint', async () => {
    const camp = useCampaignStore().create({ name: 'F' })
    const w = await mountAt(camp.id)
    await w.find('form').trigger('submit.prevent')
    expect(w.text()).toContain('enter at least one coin')
  })

  it('deposits gp through the form', async () => {
    const camp = useCampaignStore().create({ name: 'F' })
    const w = await mountAt(camp.id)
    await w.find('#amount-gp').setValue(50)
    await w.find('input[type="text"]').setValue('goblin hoard')
    await w.find('form').trigger('submit.prevent')
    const store = useTreasuryStore()
    expect(store.purseFor(camp.id as never).gp).toBe(50)
    expect(w.text()).toContain('goblin hoard')
  })

  it('switches to withdraw when selected', async () => {
    const camp = useCampaignStore().create({ name: 'F' })
    const store = useTreasuryStore()
    store.deposit(camp.id as never, { cp: 0, sp: 0, ep: 0, gp: 100, pp: 0 }, 'init')
    const w = await mountAt(camp.id)
    const select = w.find('#direction')
    await select.setValue('withdraw')
    await w.find('#amount-gp').setValue(20)
    await w.find('form').trigger('submit.prevent')
    expect(store.purseFor(camp.id as never).gp).toBe(80)
  })

  it('renders coin tiles for each denomination', async () => {
    const camp = useCampaignStore().create({ name: 'F' })
    const w = await mountAt(camp.id)
    expect(w.text()).toContain('Copper')
    expect(w.text()).toContain('Platinum')
  })
})
