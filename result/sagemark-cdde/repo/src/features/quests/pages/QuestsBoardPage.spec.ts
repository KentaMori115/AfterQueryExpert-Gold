import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'

import QuestsBoardPage from './QuestsBoardPage.vue'
import { useCampaignStore } from '@features/campaigns/store'
import { useQuestStore } from '../store'

function makeRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { template: '<div />' } },
      { path: '/campaigns', component: { template: '<div />' } },
      { path: '/campaigns/:campaignId', component: { template: '<div />' } },
      { path: '/campaigns/:campaignId/quests', component: QuestsBoardPage },
    ],
  })
}

describe('QuestsBoardPage', () => {
  let router: Router

  beforeEach(async () => {
    setActivePinia(createPinia())
    window.localStorage.clear()
    router = makeRouter()
  })

  it('not-found when campaign missing', async () => {
    await router.push('/campaigns/camp_MISSING/quests')
    await router.isReady()
    const w = mount(QuestsBoardPage, { global: { plugins: [router] } })
    expect(w.text()).toContain('Campaign not found')
  })

  it('shows empty state', async () => {
    const c = useCampaignStore().create({ name: 'X' })
    await router.push(`/campaigns/${c.id}/quests`)
    await router.isReady()
    const w = mount(QuestsBoardPage, { global: { plugins: [router] } })
    expect(w.text()).toContain('No quests yet')
  })

  it('adds a quest', async () => {
    const c = useCampaignStore().create({ name: 'X' })
    const qStore = useQuestStore()
    await router.push(`/campaigns/${c.id}/quests`)
    await router.isReady()
    const w = mount(QuestsBoardPage, { global: { plugins: [router] } })
    await w.get('#quest-title').setValue('Find the cat')
    await w.find('form').trigger('submit.prevent')
    await flushPromises()
    expect(qStore.forCampaign(c.id)).toHaveLength(1)
    expect(w.text()).toContain('Find the cat')
  })

  it('toggles objective', async () => {
    const c = useCampaignStore().create({ name: 'X' })
    const qStore = useQuestStore()
    const q = qStore.create({ campaignId: c.id, title: 'X' })
    qStore.addObjective(q.id, 'open the gate')
    await router.push(`/campaigns/${c.id}/quests`)
    await router.isReady()
    const w = mount(QuestsBoardPage, { global: { plugins: [router] } })
    const cb = w.find('input[type="checkbox"]')
    await cb.setValue(true)
    expect(qStore.byId(q.id)?.objectives[0]?.completed).toBe(true)
  })

  it('changes status via pill row', async () => {
    const c = useCampaignStore().create({ name: 'X' })
    const qStore = useQuestStore()
    const q = qStore.create({ campaignId: c.id, title: 'X' })
    await router.push(`/campaigns/${c.id}/quests`)
    await router.isReady()
    const w = mount(QuestsBoardPage, { global: { plugins: [router] } })
    const btn = w.findAll('button').find((b) => b.text() === 'Accepted')
    await btn!.trigger('click')
    expect(qStore.byId(q.id)?.status).toBe('accepted')
  })

  it('priority filter narrows the board to one priority', async () => {
    const c = useCampaignStore().create({ name: 'X' })
    const qStore = useQuestStore()
    qStore.create({ campaignId: c.id, title: 'Pressing', priority: 'urgent' })
    qStore.create({ campaignId: c.id, title: 'Background', priority: 'low' })
    await router.push(`/campaigns/${c.id}/quests`)
    await router.isReady()
    const w = mount(QuestsBoardPage, { global: { plugins: [router] } })
    await w.find('#quest-priority-filter').setValue('urgent')
    expect(w.text()).toContain('Pressing')
    expect(w.text()).not.toContain('Background')
  })

  it('delete with confirm removes', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const c = useCampaignStore().create({ name: 'X' })
    const qStore = useQuestStore()
    const q = qStore.create({ campaignId: c.id, title: 'X' })
    await router.push(`/campaigns/${c.id}/quests`)
    await router.isReady()
    const w = mount(QuestsBoardPage, { global: { plugins: [router] } })
    const del = w.findAll('button').find((b) => b.text() === 'delete')
    await del!.trigger('click')
    expect(qStore.byId(q.id)).toBe(null)
    confirmSpy.mockRestore()
  })
})
