import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'

import { useCampaignStore } from '@features/campaigns/store'

import { useJournalStore } from '../store'

import JournalPage from './JournalPage.vue'

function makeRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { template: '<div />' } },
      { path: '/journal', component: JournalPage },
    ],
  })
}

async function mountAt() {
  const router = makeRouter()
  await router.push('/journal')
  await router.isReady()
  return mount(JournalPage, { global: { plugins: [router] } })
}

describe('JournalPage', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    window.localStorage.clear()
  })

  it('shows empty state with no entries', async () => {
    const w = await mountAt()
    expect(w.text()).toContain('No entries here')
  })

  it('adds an entry via the form', async () => {
    const w = await mountAt()
    await w.find('#journal-title').setValue('Before tonight')
    await w.find('textarea').setValue('tired but eager')
    await w.find('form').trigger('submit.prevent')
    expect(useJournalStore().all).toHaveLength(1)
    expect(w.text()).toContain('Before tonight')
  })

  it('filter switches to a specific campaign', async () => {
    const campaigns = useCampaignStore()
    const camp = campaigns.create({ name: 'Frostfall' })
    const store = useJournalStore()
    store.create({ campaignId: null, title: 'Global', body: 'g' })
    store.create({ campaignId: camp.id, title: 'Camp', body: 'c' })
    const w = await mountAt()
    await w.find('#journal-filter').setValue(camp.id)
    expect(w.text()).toContain('Camp')
    expect(w.text()).not.toContain('Global')
  })

  it('shows the streak badge when three entries match', async () => {
    const store = useJournalStore()
    store.create({ campaignId: null, title: 'a', body: 'a', mood: 'tired' })
    store.create({ campaignId: null, title: 'b', body: 'b', mood: 'tired' })
    store.create({ campaignId: null, title: 'c', body: 'c', mood: 'tired' })
    const w = await mountAt()
    await w.find('#journal-filter').setValue('global')
    expect(w.text()).toContain('mood streak')
  })
})
