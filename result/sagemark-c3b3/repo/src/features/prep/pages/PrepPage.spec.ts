import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'

import { useCampaignStore } from '@features/campaigns/store'
import { useSessionStore } from '@features/sessions/store'

import PrepPage from './PrepPage.vue'

function makeRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { template: '<div />' } },
      { path: '/campaigns', component: { template: '<div />' } },
      { path: '/campaigns/:campaignId', component: { template: '<div />' } },
      { path: '/campaigns/:campaignId/sessions', component: { template: '<div />' } },
      { path: '/campaigns/:campaignId/prep', component: PrepPage },
      { path: '/campaigns/:campaignId/prep/:sessionId', component: PrepPage },
    ],
  })
}

async function mountAt(path: string) {
  const router = makeRouter()
  await router.push(path)
  await router.isReady()
  return mount(PrepPage, { global: { plugins: [router] } })
}

describe('PrepPage', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    window.localStorage.clear()
  })

  it('shows campaign not found for a bogus id', async () => {
    const w = await mountAt('/campaigns/camp_missing/prep')
    expect(w.text()).toContain('Campaign not found')
  })

  it('renders the next session header when no session is provided', async () => {
    const camp = useCampaignStore().create({ name: 'F', summary: 's' })
    const w = await mountAt(`/campaigns/${camp.id}/prep`)
    expect(w.text()).toContain('Next session prep')
  })

  it('switches to the session specific header when an id is in the URL', async () => {
    const camp = useCampaignStore().create({ name: 'F', summary: 's' })
    const sessions = useSessionStore()
    const s = sessions.create({
      campaignId: camp.id,
      title: 'The Frost Bell',
      playedAt: new Date().toISOString(),
    })
    const w = await mountAt(`/campaigns/${camp.id}/prep/${s.id}`)
    expect(w.text()).toContain('Prep for Session')
    expect(w.text()).toContain('The Frost Bell')
  })

  it('lists recent sessions for quick navigation', async () => {
    const camp = useCampaignStore().create({ name: 'F', summary: 's' })
    const sessions = useSessionStore()
    sessions.create({
      campaignId: camp.id,
      title: 'A',
      playedAt: new Date('2026-01-01').toISOString(),
    })
    sessions.create({
      campaignId: camp.id,
      title: 'B',
      playedAt: new Date('2026-02-01').toISOString(),
    })
    const w = await mountAt(`/campaigns/${camp.id}/prep`)
    expect(w.text()).toContain('Other recent sessions')
    expect(w.text()).toContain('Next session (not yet logged)')
  })
})
