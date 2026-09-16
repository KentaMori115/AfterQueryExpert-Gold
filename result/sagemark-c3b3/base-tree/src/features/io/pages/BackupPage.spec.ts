import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'

import BackupPage from './BackupPage.vue'
import { useCampaignStore } from '@features/campaigns/store'
import { useCharacterStore } from '@features/characters/store'

function makeRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { template: '<div />' } },
      { path: '/campaigns', component: { template: '<div />' } },
      { path: '/campaigns/:campaignId', component: { template: '<div />' } },
      { path: '/campaigns/:campaignId/backup', component: BackupPage },
    ],
  })
}

describe('BackupPage', () => {
  let router: Router

  beforeEach(async () => {
    setActivePinia(createPinia())
    window.localStorage.clear()
    router = makeRouter()
  })

  it('not-found when campaign missing', async () => {
    await router.push('/campaigns/camp_MISSING/backup')
    await router.isReady()
    const w = mount(BackupPage, { global: { plugins: [router] } })
    expect(w.text()).toContain('Campaign not found')
  })

  it('builds an export when button is clicked', async () => {
    const c = useCampaignStore().create({ name: 'X' })
    await router.push(`/campaigns/${c.id}/backup`)
    await router.isReady()
    const w = mount(BackupPage, { global: { plugins: [router] } })
    const btn = w.findAll('button').find((b) => b.text() === 'Build export')
    await btn!.trigger('click')
    const ta = w.findAll('textarea').find((t) => (t.element as HTMLTextAreaElement).readOnly)
    expect((ta!.element as HTMLTextAreaElement).value).toContain('"version"')
  })

  it('imports characters from csv', async () => {
    const c = useCampaignStore().create({ name: 'X' })
    const chStore = useCharacterStore()
    await router.push(`/campaigns/${c.id}/backup`)
    await router.isReady()
    const w = mount(BackupPage, { global: { plugins: [router] } })
    await w.get('#csv-input').setValue('name\nIris\nBrann')
    const btn = w.findAll('button').find((b) => b.text() === 'Import')
    await btn!.trigger('click')
    await flushPromises()
    expect(chStore.forCampaign(c.id)).toHaveLength(2)
    expect(w.text()).toContain('Imported 2')
  })

  it('reports csv errors', async () => {
    const c = useCampaignStore().create({ name: 'X' })
    await router.push(`/campaigns/${c.id}/backup`)
    await router.isReady()
    const w = mount(BackupPage, { global: { plugins: [router] } })
    await w.get('#csv-input').setValue('not_name\nfoo')
    const btn = w.findAll('button').find((b) => b.text() === 'Import')
    await btn!.trigger('click')
    expect(w.text()).toContain('Could not import')
  })
})
