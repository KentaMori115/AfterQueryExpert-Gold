import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'

import RelationshipsPage from './RelationshipsPage.vue'
import { useCampaignStore } from '@features/campaigns/store'
import { useCharacterStore } from '@features/characters/store'
import { useRelationshipStore } from '../store'

function makeRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { template: '<div />' } },
      { path: '/campaigns', component: { template: '<div />' } },
      { path: '/campaigns/:campaignId', component: { template: '<div />' } },
      { path: '/campaigns/:campaignId/relationships', component: RelationshipsPage },
    ],
  })
}

describe('RelationshipsPage', () => {
  let router: Router

  beforeEach(async () => {
    setActivePinia(createPinia())
    window.localStorage.clear()
    router = makeRouter()
  })

  it('not-found when campaign is missing', async () => {
    await router.push('/campaigns/camp_MISSING/relationships')
    await router.isReady()
    const w = mount(RelationshipsPage, { global: { plugins: [router] } })
    expect(w.text()).toContain('Campaign not found')
  })

  it('shows empty bonds state', async () => {
    const c = useCampaignStore().create({ name: 'X' })
    await router.push(`/campaigns/${c.id}/relationships`)
    await router.isReady()
    const w = mount(RelationshipsPage, { global: { plugins: [router] } })
    expect(w.text()).toContain('No bonds yet')
  })

  it('adds a bond between two characters', async () => {
    const cStore = useCampaignStore()
    const chStore = useCharacterStore()
    const c = cStore.create({ name: 'X' })
    const a = chStore.create({ campaignId: c.id, name: 'Iris' })
    const b = chStore.create({ campaignId: c.id, name: 'Brann' })
    const rStore = useRelationshipStore()
    await router.push(`/campaigns/${c.id}/relationships`)
    await router.isReady()
    const w = mount(RelationshipsPage, { global: { plugins: [router] } })
    const selects = w.findAll('select')
    // 0: from-kind, 1: from-id, 2: to-kind, 3: to-id, 4: kind
    await selects[1]!.setValue(a.id)
    await selects[3]!.setValue(b.id)
    await selects[4]!.setValue('ally')
    await w.find('form').trigger('submit.prevent')
    await flushPromises()
    expect(rStore.forCampaign(c.id)).toHaveLength(1)
    expect(w.text()).toContain('Iris')
    expect(w.text()).toContain('Brann')
  })

  it('refuses to add without picking endpoints', async () => {
    const c = useCampaignStore().create({ name: 'X' })
    await router.push(`/campaigns/${c.id}/relationships`)
    await router.isReady()
    const w = mount(RelationshipsPage, { global: { plugins: [router] } })
    await w.find('form').trigger('submit.prevent')
    expect(w.text().toLowerCase()).toContain('pick a from')
  })

  it('remove drops a bond with confirm', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const c = useCampaignStore().create({ name: 'X' })
    const chStore = useCharacterStore()
    const a = chStore.create({ campaignId: c.id, name: 'A' })
    const b = chStore.create({ campaignId: c.id, name: 'B' })
    const rStore = useRelationshipStore()
    rStore.create({
      campaignId: c.id,
      from: { kind: 'character', id: a.id },
      to: { kind: 'character', id: b.id },
    })
    await router.push(`/campaigns/${c.id}/relationships`)
    await router.isReady()
    const w = mount(RelationshipsPage, { global: { plugins: [router] } })
    const remove = w.findAll('button').find((btn) => btn.text() === 'remove')
    await remove!.trigger('click')
    expect(rStore.forCampaign(c.id)).toHaveLength(0)
    confirmSpy.mockRestore()
  })
})
