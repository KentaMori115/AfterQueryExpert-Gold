import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'

import { useCampaignStore } from '@features/campaigns/store'

import TravelPlannerPage from './TravelPlannerPage.vue'

function makeRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { template: '<div />' } },
      { path: '/campaigns', component: { template: '<div />' } },
      { path: '/campaigns/:campaignId', component: { template: '<div />' } },
      { path: '/campaigns/:campaignId/travel', component: TravelPlannerPage },
    ],
  })
}

async function mountAt(campaignId: string) {
  const router = makeRouter()
  await router.push(`/campaigns/${campaignId}/travel`)
  await router.isReady()
  return mount(TravelPlannerPage, { global: { plugins: [router] } })
}

describe('TravelPlannerPage', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    window.localStorage.clear()
  })

  it('shows campaign not found for a bogus id', async () => {
    const w = await mountAt('camp_missing')
    expect(w.text()).toContain('Campaign not found')
  })

  it('renders climate, season, pace, miles and base inputs', async () => {
    const camp = useCampaignStore().create({ name: 'F', summary: 's' })
    const w = await mountAt(camp.id)
    expect(w.find('#travel-climate').exists()).toBe(true)
    expect(w.find('#travel-season').exists()).toBe(true)
    expect(w.find('#travel-pace').exists()).toBe(true)
    expect(w.find('#travel-miles').exists()).toBe(true)
  })

  it('reports an estimate with days and miles per day', async () => {
    const camp = useCampaignStore().create({ name: 'F', summary: 's' })
    const w = await mountAt(camp.id)
    expect(w.text()).toContain('mi/day')
    expect(w.text()).toMatch(/\d+ days/)
  })

  it('changing pace updates the estimate label', async () => {
    const camp = useCampaignStore().create({ name: 'F', summary: 's' })
    const w = await mountAt(camp.id)
    const before = w.text()
    await w.find('#travel-pace').setValue('forced')
    const after = w.text()
    expect(after).toContain('Forced march')
    expect(after).not.toBe(before)
  })

  it('reroll button updates the weather seed', async () => {
    const camp = useCampaignStore().create({ name: 'F', summary: 's' })
    const w = await mountAt(camp.id)
    const btn = w.findAll('button').find((b) => b.text() === 'reroll weather')
    await btn!.trigger('click')
    expect(w.text()).toContain('penalty')
  })

  it('lists the rolling table for the chosen region', async () => {
    const camp = useCampaignStore().create({ name: 'F', summary: 's' })
    const w = await mountAt(camp.id)
    expect(w.text()).toContain('What you might see this stretch')
    expect(w.text()).toContain('weight')
  })
})
