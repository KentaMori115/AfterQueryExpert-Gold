import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'

import SessionDetailPage from './SessionDetailPage.vue'
import { useCampaignStore } from '@features/campaigns/store'
import { useCharacterStore } from '@features/characters/store'
import { useSessionStore } from '../store'

function makeRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { template: '<div />' } },
      { path: '/campaigns', component: { template: '<div />' } },
      { path: '/campaigns/:campaignId', component: { template: '<div />' } },
      { path: '/campaigns/:campaignId/sessions', component: { template: '<div />' } },
      { path: '/campaigns/:campaignId/sessions/:id', component: SessionDetailPage },
      { path: '/campaigns/:campaignId/sessions/:id/edit', component: { template: '<div />' } },
    ],
  })
}

describe('SessionDetailPage', () => {
  let router: Router

  beforeEach(async () => {
    setActivePinia(createPinia())
    window.localStorage.clear()
    router = makeRouter()
  })

  it('not-found for missing session', async () => {
    const cStore = useCampaignStore()
    const c = cStore.create({ name: 'X' })
    await router.push(`/campaigns/${c.id}/sessions/ses_MISSING000`)
    await router.isReady()
    const w = mount(SessionDetailPage, { global: { plugins: [router] } })
    expect(w.text()).toContain('Not found')
  })

  it('shows session details', async () => {
    const cStore = useCampaignStore()
    const sStore = useSessionStore()
    const c = cStore.create({ name: 'X' })
    const s = sStore.create({
      campaignId: c.id,
      title: 'Frostbite',
      playedAt: '2025-04-01T20:00:00Z',
      durationMinutes: 180,
      summary: 'They warmed up',
    })
    await router.push(`/campaigns/${c.id}/sessions/${s.id}`)
    await router.isReady()
    const w = mount(SessionDetailPage, { global: { plugins: [router] } })
    expect(w.text()).toContain('Frostbite')
    expect(w.text()).toContain('3h')
    expect(w.text()).toContain('They warmed up')
  })

  it('lists party characters for attendance', async () => {
    const cStore = useCampaignStore()
    const sStore = useSessionStore()
    const chStore = useCharacterStore()
    const c = cStore.create({ name: 'X' })
    chStore.create({ campaignId: c.id, name: 'Iris', kind: 'pc' })
    chStore.create({ campaignId: c.id, name: 'Brann', kind: 'pc' })
    chStore.create({ campaignId: c.id, name: 'NPC1', kind: 'npc' })
    const s = sStore.create({ campaignId: c.id, title: 'X', playedAt: '2025-04-01T20:00:00Z' })
    await router.push(`/campaigns/${c.id}/sessions/${s.id}`)
    await router.isReady()
    const w = mount(SessionDetailPage, { global: { plugins: [router] } })
    expect(w.text()).toContain('Iris')
    expect(w.text()).toContain('Brann')
    expect(w.text()).not.toContain('NPC1')
  })

  it('toggles attendance on checkbox change', async () => {
    const cStore = useCampaignStore()
    const sStore = useSessionStore()
    const chStore = useCharacterStore()
    const c = cStore.create({ name: 'X' })
    const iris = chStore.create({ campaignId: c.id, name: 'Iris', kind: 'pc' })
    const s = sStore.create({ campaignId: c.id, title: 'X', playedAt: '2025-04-01T20:00:00Z' })
    await router.push(`/campaigns/${c.id}/sessions/${s.id}`)
    await router.isReady()
    const w = mount(SessionDetailPage, { global: { plugins: [router] } })
    const cb = w.find('input[type="checkbox"]')
    await cb.setValue(true)
    expect(sStore.byId(s.id)?.attendees).toContain(iris.id)
  })

  it('saves log via the Save log button', async () => {
    const cStore = useCampaignStore()
    const sStore = useSessionStore()
    const c = cStore.create({ name: 'X' })
    const s = sStore.create({ campaignId: c.id, title: 'X', playedAt: '2025-04-01T20:00:00Z' })
    await router.push(`/campaigns/${c.id}/sessions/${s.id}`)
    await router.isReady()
    const w = mount(SessionDetailPage, { global: { plugins: [router] } })
    const ta = w.find('textarea')
    await ta.setValue('They burned it.')
    const save = w.findAll('button').find((b) => b.text() === 'Save log')
    await save!.trigger('click')
    expect(sStore.byId(s.id)?.log).toBe('They burned it.')
  })

  it('delete with confirm removes', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const cStore = useCampaignStore()
    const sStore = useSessionStore()
    const c = cStore.create({ name: 'X' })
    const s = sStore.create({ campaignId: c.id, title: 'X', playedAt: '2025-04-01T20:00:00Z' })
    await router.push(`/campaigns/${c.id}/sessions/${s.id}`)
    await router.isReady()
    const w = mount(SessionDetailPage, { global: { plugins: [router] } })
    const del = w.findAll('button').find((b) => b.text() === 'Delete this session')
    await del!.trigger('click')
    await flushPromises()
    expect(sStore.byId(s.id)).toBe(null)
    confirmSpy.mockRestore()
  })
})
