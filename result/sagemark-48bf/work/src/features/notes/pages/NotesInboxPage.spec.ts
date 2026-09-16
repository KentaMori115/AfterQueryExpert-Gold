import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'

import NotesInboxPage from './NotesInboxPage.vue'
import { useCampaignStore } from '@features/campaigns/store'
import { useCharacterStore } from '@features/characters/store'
import { useFactionStore } from '@features/factions/store'
import { useNoteStore } from '../store'

function makeRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { template: '<div />' } },
      { path: '/campaigns', component: { template: '<div />' } },
      { path: '/campaigns/:campaignId', component: { template: '<div />' } },
      { path: '/campaigns/:campaignId/notes', component: NotesInboxPage },
      { path: '/campaigns/:campaignId/characters/:id', component: { template: '<div />' } },
      { path: '/campaigns/:campaignId/factions/:id', component: { template: '<div />' } },
    ],
  })
}

describe('NotesInboxPage', () => {
  let router: Router

  beforeEach(async () => {
    setActivePinia(createPinia())
    window.localStorage.clear()
    router = makeRouter()
  })

  it('shows not found when campaign is missing', async () => {
    await router.push('/campaigns/camp_MISSING/notes')
    await router.isReady()
    const w = mount(NotesInboxPage, { global: { plugins: [router] } })
    expect(w.text()).toContain('Campaign not found')
  })

  it('renders only open notes by default', async () => {
    const c = useCampaignStore().create({ name: 'X' })
    const ch = useCharacterStore().create({ campaignId: c.id, name: 'Iris' })
    const notes = useNoteStore()
    notes.create({
      campaignId: c.id,
      target: { kind: 'character', id: ch.id },
      body: 'still open',
    })
    const done = notes.create({
      campaignId: c.id,
      target: { kind: 'character', id: ch.id },
      body: 'old done',
    })
    notes.resolve(done.id)
    await router.push(`/campaigns/${c.id}/notes`)
    await router.isReady()
    const w = mount(NotesInboxPage, { global: { plugins: [router] } })
    expect(w.text()).toContain('still open')
    expect(w.text()).not.toContain('old done')
  })

  it('shows resolved when the filter switches', async () => {
    const c = useCampaignStore().create({ name: 'X' })
    const ch = useCharacterStore().create({ campaignId: c.id, name: 'Iris' })
    const notes = useNoteStore()
    const n = notes.create({
      campaignId: c.id,
      target: { kind: 'character', id: ch.id },
      body: 'archived note',
    })
    notes.resolve(n.id)
    await router.push(`/campaigns/${c.id}/notes`)
    await router.isReady()
    const w = mount(NotesInboxPage, { global: { plugins: [router] } })
    const select = w.findAll('select')[0]!
    await select.setValue('resolved')
    expect(w.text()).toContain('archived note')
  })

  it('filters by target kind', async () => {
    const c = useCampaignStore().create({ name: 'X' })
    const ch = useCharacterStore().create({ campaignId: c.id, name: 'Iris' })
    const f = useFactionStore().create({ campaignId: c.id, name: 'Iron Hand' })
    const notes = useNoteStore()
    notes.create({
      campaignId: c.id,
      target: { kind: 'character', id: ch.id },
      body: 'about iris',
    })
    notes.create({
      campaignId: c.id,
      target: { kind: 'faction', id: f.id },
      body: 'about iron hand',
    })
    await router.push(`/campaigns/${c.id}/notes`)
    await router.isReady()
    const w = mount(NotesInboxPage, { global: { plugins: [router] } })
    const kindSelect = w.findAll('select')[1]!
    await kindSelect.setValue('faction')
    expect(w.text()).toContain('about iron hand')
    expect(w.text()).not.toContain('about iris')
  })

  it('search filters by body or title fragment', async () => {
    const c = useCampaignStore().create({ name: 'X' })
    const ch = useCharacterStore().create({ campaignId: c.id, name: 'Iris' })
    const notes = useNoteStore()
    notes.create({
      campaignId: c.id,
      target: { kind: 'character', id: ch.id },
      body: 'find the gate',
    })
    notes.create({
      campaignId: c.id,
      target: { kind: 'character', id: ch.id },
      body: 'something else entirely',
    })
    await router.push(`/campaigns/${c.id}/notes`)
    await router.isReady()
    const w = mount(NotesInboxPage, { global: { plugins: [router] } })
    const search = w.find('input[type="search"]')
    await search.setValue('gate')
    expect(w.text()).toContain('find the gate')
    expect(w.text()).not.toContain('something else entirely')
  })

  it('cycle priority advances through the priorities', async () => {
    const c = useCampaignStore().create({ name: 'X' })
    const ch = useCharacterStore().create({ campaignId: c.id, name: 'Iris' })
    const notes = useNoteStore()
    const n = notes.create({
      campaignId: c.id,
      target: { kind: 'character', id: ch.id },
      body: 'a',
    })
    await router.push(`/campaigns/${c.id}/notes`)
    await router.isReady()
    const w = mount(NotesInboxPage, { global: { plugins: [router] } })
    const cycle = w.findAll('button').find((b) => b.text() === 'cycle priority')
    await cycle!.trigger('click')
    expect(notes.byId(n.id)?.priority).toBe('high')
  })

  it('delete with confirm removes the note', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const c = useCampaignStore().create({ name: 'X' })
    const ch = useCharacterStore().create({ campaignId: c.id, name: 'Iris' })
    const notes = useNoteStore()
    const n = notes.create({
      campaignId: c.id,
      target: { kind: 'character', id: ch.id },
      body: 'doomed',
    })
    await router.push(`/campaigns/${c.id}/notes`)
    await router.isReady()
    const w = mount(NotesInboxPage, { global: { plugins: [router] } })
    const del = w.findAll('button').find((b) => b.text() === 'delete')
    await del!.trigger('click')
    await flushPromises()
    expect(notes.byId(n.id)).toBe(null)
    confirmSpy.mockRestore()
  })
})
