import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'

import { useCampaignStore } from '@features/campaigns/store'

import { useHolidayStore } from '../store'

import HolidaysPage from './HolidaysPage.vue'

function makeRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { template: '<div />' } },
      { path: '/campaigns', component: { template: '<div />' } },
      { path: '/campaigns/:campaignId', component: { template: '<div />' } },
      { path: '/campaigns/:campaignId/holidays', component: HolidaysPage },
    ],
  })
}

async function mountAt(campaignId: string) {
  const router = makeRouter()
  await router.push(`/campaigns/${campaignId}/holidays`)
  await router.isReady()
  return mount(HolidaysPage, { global: { plugins: [router] } })
}

describe('HolidaysPage', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    window.localStorage.clear()
  })

  it('shows campaign not found for a bogus id', async () => {
    const w = await mountAt('camp_missing')
    expect(w.text()).toContain('Campaign not found')
  })

  it('empty state when no holidays are saved', async () => {
    const camp = useCampaignStore().create({ name: 'F' })
    const w = await mountAt(camp.id)
    expect(w.text()).toContain('No holidays yet')
  })

  it('adds a holiday through the form', async () => {
    const camp = useCampaignStore().create({ name: 'F' })
    const w = await mountAt(camp.id)
    await w.find('#hol-name').setValue('Frost Eve')
    await w.find('form').trigger('submit.prevent')
    expect(useHolidayStore().forCampaign(camp.id as never)).toHaveLength(1)
    expect(w.text()).toContain('Frost Eve')
  })

  it('shows upcoming holidays from the cursor', async () => {
    const camp = useCampaignStore().create({ name: 'F' })
    const store = useHolidayStore()
    store.create({ campaignId: camp.id as never, name: 'Sun High', month: 6, day: 21 })
    store.create({ campaignId: camp.id as never, name: 'Frost', month: 12, day: 31 })
    const w = await mountAt(camp.id)
    await w.find('#cursor-month').setValue(11)
    expect(w.text()).toContain('Frost')
  })
})
