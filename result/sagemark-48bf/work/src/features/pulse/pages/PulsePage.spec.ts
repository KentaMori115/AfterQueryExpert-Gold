import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'

import { useCampaignStore } from '@features/campaigns/store'
import { useQuestStore } from '@features/quests/store'
import { useSessionStore } from '@features/sessions/store'

import PulsePage from './PulsePage.vue'

function makeRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { template: '<div />' } },
      { path: '/campaigns', component: { template: '<div />' } },
      { path: '/campaigns/:campaignId', component: { template: '<div />' } },
      { path: '/campaigns/:campaignId/pulse', component: PulsePage },
    ],
  })
}

async function mountAt(campaignId: string) {
  const router = makeRouter()
  await router.push(`/campaigns/${campaignId}/pulse`)
  await router.isReady()
  return mount(PulsePage, { global: { plugins: [router] } })
}

describe('PulsePage', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    window.localStorage.clear()
  })

  it('shows campaign not found for a bogus id', async () => {
    const w = await mountAt('camp_missing')
    expect(w.text()).toContain('Campaign not found')
  })

  it('renders freshness as cold when no sessions exist', async () => {
    const camp = useCampaignStore().create({ name: 'F' })
    const w = await mountAt(camp.id)
    expect(w.text()).toContain('cold')
    expect(w.text()).toContain('Nothing pressing')
  })

  it('lists open quests in the beats', async () => {
    const camp = useCampaignStore().create({ name: 'F' })
    useQuestStore().create({ campaignId: camp.id, title: 'Find the bell', status: 'accepted' })
    const w = await mountAt(camp.id)
    expect(w.text()).toContain('Find the bell')
    expect(w.text()).toContain('open-quest')
  })

  it('marks freshness as fresh after a recent session', async () => {
    const camp = useCampaignStore().create({ name: 'F' })
    useSessionStore().create({
      campaignId: camp.id,
      title: 'Yesterday',
      playedAt: new Date().toISOString(),
    })
    const w = await mountAt(camp.id)
    expect(w.text()).toContain('fresh')
  })
})
