import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'

import EncountersListPage from './EncountersListPage.vue'
import EncounterNewPage from './EncounterNewPage.vue'
import EncounterDetailPage from './EncounterDetailPage.vue'
import EncounterEditPage from './EncounterEditPage.vue'
import { useCampaignStore } from '@features/campaigns/store'
import { useEncounterStore } from '../store'

function makeRouter(extra: { path: string; component: unknown }[]): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { template: '<div />' } },
      { path: '/campaigns', component: { template: '<div />' } },
      { path: '/campaigns/:campaignId', component: { template: '<div />' } },
      { path: '/campaigns/:campaignId/encounters', component: { template: '<div />' } },
      { path: '/campaigns/:campaignId/encounters/new', component: { template: '<div />' } },
      { path: '/campaigns/:campaignId/encounters/:id', component: { template: '<div />' } },
      { path: '/campaigns/:campaignId/encounters/:id/edit', component: { template: '<div />' } },
      ...(extra as never),
    ],
  })
}

describe('EncountersListPage', () => {
  let router: Router

  beforeEach(async () => {
    setActivePinia(createPinia())
    window.localStorage.clear()
    router = makeRouter([{ path: '/campaigns/:campaignId/encounters', component: EncountersListPage }])
  })

  it('not-found when campaign missing', async () => {
    await router.push('/campaigns/camp_MISSING/encounters')
    await router.isReady()
    const w = mount(EncountersListPage, { global: { plugins: [router] } })
    expect(w.text()).toContain('Campaign not found')
  })

  it('shows empty state', async () => {
    const c = useCampaignStore().create({ name: 'X' })
    await router.push(`/campaigns/${c.id}/encounters`)
    await router.isReady()
    const w = mount(EncountersListPage, { global: { plugins: [router] } })
    expect(w.text()).toContain('No encounters yet')
  })

  it('partitions open vs resolved', async () => {
    const c = useCampaignStore().create({ name: 'X' })
    const eStore = useEncounterStore()
    eStore.create({ campaignId: c.id, title: 'open' })
    eStore.create({ campaignId: c.id, title: 'closed', resolved: true })
    await router.push(`/campaigns/${c.id}/encounters`)
    await router.isReady()
    const w = mount(EncountersListPage, { global: { plugins: [router] } })
    expect(w.text()).toContain('Ready to drop')
    expect(w.text()).toContain('Played out')
  })
})

describe('EncounterNewPage', () => {
  let router: Router

  beforeEach(async () => {
    setActivePinia(createPinia())
    window.localStorage.clear()
    router = makeRouter([{ path: '/campaigns/:campaignId/encounters/new', component: EncounterNewPage }])
  })

  it('creates and routes to detail', async () => {
    const c = useCampaignStore().create({ name: 'X' })
    const eStore = useEncounterStore()
    await router.push(`/campaigns/${c.id}/encounters/new`)
    await router.isReady()
    const w = mount(EncounterNewPage, { global: { plugins: [router] } })
    await w.get('#encounter-title').setValue('Goblins')
    await w.find('form').trigger('submit.prevent')
    await flushPromises()
    expect(eStore.forCampaign(c.id)).toHaveLength(1)
  })

  it('cancel returns to list', async () => {
    const c = useCampaignStore().create({ name: 'X' })
    await router.push(`/campaigns/${c.id}/encounters/new`)
    await router.isReady()
    const w = mount(EncounterNewPage, { global: { plugins: [router] } })
    const back = w.findAll('button').find((b) => b.text() === 'Back')
    await back!.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe(`/campaigns/${c.id}/encounters`)
  })
})

describe('EncounterDetailPage', () => {
  let router: Router

  beforeEach(async () => {
    setActivePinia(createPinia())
    window.localStorage.clear()
    router = makeRouter([{ path: '/campaigns/:campaignId/encounters/:id', component: EncounterDetailPage }])
  })

  it('shows details', async () => {
    const c = useCampaignStore().create({ name: 'X' })
    const e = useEncounterStore().create({ campaignId: c.id, title: 'Goblins', summary: 'ambush' })
    await router.push(`/campaigns/${c.id}/encounters/${e.id}`)
    await router.isReady()
    const w = mount(EncounterDetailPage, { global: { plugins: [router] } })
    expect(w.text()).toContain('Goblins')
    expect(w.text()).toContain('ambush')
  })

  it('toggles resolved', async () => {
    const c = useCampaignStore().create({ name: 'X' })
    const eStore = useEncounterStore()
    const e = eStore.create({ campaignId: c.id, title: 'X' })
    await router.push(`/campaigns/${c.id}/encounters/${e.id}`)
    await router.isReady()
    const w = mount(EncounterDetailPage, { global: { plugins: [router] } })
    const btn = w.findAll('button').find((b) => b.text() === 'Mark resolved')
    await btn!.trigger('click')
    expect(eStore.byId(e.id)?.resolved).toBe(true)
  })

  it('delete with confirm removes', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const c = useCampaignStore().create({ name: 'X' })
    const eStore = useEncounterStore()
    const e = eStore.create({ campaignId: c.id, title: 'X' })
    await router.push(`/campaigns/${c.id}/encounters/${e.id}`)
    await router.isReady()
    const w = mount(EncounterDetailPage, { global: { plugins: [router] } })
    const del = w.findAll('button').find((b) => b.text() === 'Delete')
    await del!.trigger('click')
    await flushPromises()
    expect(eStore.byId(e.id)).toBe(null)
    confirmSpy.mockRestore()
  })
})

describe('EncounterEditPage', () => {
  let router: Router

  beforeEach(async () => {
    setActivePinia(createPinia())
    window.localStorage.clear()
    router = makeRouter([{ path: '/campaigns/:campaignId/encounters/:id/edit', component: EncounterEditPage }])
  })

  it('seeds and saves', async () => {
    const c = useCampaignStore().create({ name: 'X' })
    const eStore = useEncounterStore()
    const e = eStore.create({ campaignId: c.id, title: 'Old' })
    await router.push(`/campaigns/${c.id}/encounters/${e.id}/edit`)
    await router.isReady()
    const w = mount(EncounterEditPage, { global: { plugins: [router] } })
    expect((w.get('#encounter-title').element as HTMLInputElement).value).toBe('Old')
    await w.get('#encounter-title').setValue('New')
    await w.find('form').trigger('submit.prevent')
    await flushPromises()
    expect(eStore.byId(e.id)?.title).toBe('New')
  })
})
