import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'

import { useCampaignStore } from '@features/campaigns/store'
import { useSessionStore } from '@features/sessions/store'

import RecapPage from './RecapPage.vue'

function makeRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { template: '<div />' } },
      { path: '/campaigns', component: { template: '<div />' } },
      { path: '/campaigns/:campaignId', component: { template: '<div />' } },
      { path: '/campaigns/:campaignId/recap', component: RecapPage },
    ],
  })
}

async function mountAt(campaignId: string) {
  const router = makeRouter()
  await router.push(`/campaigns/${campaignId}/recap`)
  await router.isReady()
  return mount(RecapPage, { global: { plugins: [router] } })
}

describe('RecapPage', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    window.localStorage.clear()
  })

  it('shows campaign not found for a bogus id', async () => {
    const w = await mountAt('camp_missing')
    expect(w.text()).toContain('Campaign not found')
  })

  it('shows the empty state when nothing has been logged', async () => {
    const camp = useCampaignStore().create({ name: 'F' })
    const w = await mountAt(camp.id)
    expect(w.text()).toContain('Nothing to recap yet')
  })

  it('renders the markdown block once a session is logged', async () => {
    const camp = useCampaignStore().create({ name: 'Frostfall' })
    useSessionStore().create({
      campaignId: camp.id,
      title: 'The first ring',
      playedAt: new Date().toISOString(),
      summary: 'opened with the bell',
    })
    const w = await mountAt(camp.id)
    expect(w.text()).toContain('Last sessions')
    expect(w.text()).toContain('# Where we left off in Frostfall')
  })

  it('lookback input is accepted and resizes the recap', async () => {
    const camp = useCampaignStore().create({ name: 'F' })
    const sessions = useSessionStore()
    for (let i = 0; i < 4; i++) {
      sessions.create({
        campaignId: camp.id,
        title: `S${i}`,
        playedAt: new Date(2026, 0, i + 1).toISOString(),
        summary: `s${i}`,
      })
    }
    const w = await mountAt(camp.id)
    const input = w.find('#recap-lookback')
    await input.setValue(1)
    expect(w.text()).toContain('S3')
    expect(w.text()).not.toContain('S0')
  })
})
