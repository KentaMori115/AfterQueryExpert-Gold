import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'

import { asCampaignId, asCharacterId } from '@core/ids'

import BacklinksPanel from './BacklinksPanel.vue'
import { useCampaignStore } from '@features/campaigns/store'
import { useNoteStore } from '@features/notes/store'
import { useLoreStore } from '@features/lore/store'
import { useSessionStore } from '@features/sessions/store'

function makeRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/:rest(.*)', component: { template: '<div />' } }],
  })
}

describe('BacklinksPanel', () => {
  let router: Router

  beforeEach(async () => {
    setActivePinia(createPinia())
    window.localStorage.clear()
    router = makeRouter()
    await router.push('/')
    await router.isReady()
  })

  it('shows the hint when there are no mentions', () => {
    const c = useCampaignStore().create({ name: 'X' })
    const w = mount(BacklinksPanel, {
      props: { campaignId: asCampaignId(c.id), name: 'Iris' },
      global: { plugins: [router] },
    })
    expect(w.text()).toContain('Mention this entry')
  })

  it('groups results by note lore session', () => {
    const c = useCampaignStore().create({ name: 'X' })
    const notes = useNoteStore()
    notes.create({
      campaignId: c.id,
      target: { kind: 'character', id: asCharacterId('char_A') },
      body: 'about [[Iris]]',
    })
    const lore = useLoreStore()
    lore.create({ campaignId: c.id, title: 'Tale', body: '[[Iris]] sang' })
    const sessions = useSessionStore()
    sessions.create({
      campaignId: c.id,
      title: 'Night',
      playedAt: '2026-01-01T20:00:00Z',
      log: 'meet [[Iris]]',
    })
    const w = mount(BacklinksPanel, {
      props: { campaignId: asCampaignId(c.id), name: 'Iris' },
      global: { plugins: [router] },
    })
    expect(w.text()).toContain('Mentioned in (3)')
    expect(w.findAll('.link')).toHaveLength(3)
  })

  it('honours a custom title', () => {
    const c = useCampaignStore().create({ name: 'X' })
    const w = mount(BacklinksPanel, {
      props: { campaignId: asCampaignId(c.id), name: 'Iris', title: 'Said the page' },
      global: { plugins: [router] },
    })
    expect(w.text()).toContain('Said the page')
  })
})
