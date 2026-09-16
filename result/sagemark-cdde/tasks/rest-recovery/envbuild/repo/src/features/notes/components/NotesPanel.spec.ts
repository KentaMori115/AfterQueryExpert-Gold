import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { asCampaignId, asCharacterId } from '@core/ids'

import NotesPanel from './NotesPanel.vue'
import { useNoteStore } from '../store'

const campaignId = asCampaignId('camp_TESTABCDEF')
const target = { kind: 'character' as const, id: asCharacterId('char_A0000000') }

describe('NotesPanel', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    window.localStorage.clear()
  })

  it('shows the empty message when there are no notes', () => {
    const w = mount(NotesPanel, { props: { campaignId, target } })
    expect(w.text()).toContain('No notes yet for this entry')
  })

  it('opens the composer when Add note is clicked', async () => {
    const w = mount(NotesPanel, { props: { campaignId, target } })
    const add = w.findAll('button').find((b) => b.text() === 'Add note')
    await add!.trigger('click')
    expect(w.find('#note-body').exists()).toBe(true)
  })

  it('creates a note via the composer', async () => {
    const notes = useNoteStore()
    const w = mount(NotesPanel, { props: { campaignId, target } })
    const add = w.findAll('button').find((b) => b.text() === 'Add note')
    await add!.trigger('click')
    await w.get('#note-body').setValue('Bring lanterns')
    await w.find('form').trigger('submit.prevent')
    await flushPromises()
    expect(notes.forTarget(campaignId, target)).toHaveLength(1)
    expect(w.text()).toContain('Bring lanterns')
  })

  it('mark done sets the resolvedAt', async () => {
    const notes = useNoteStore()
    const n = notes.create({ campaignId, target, body: 'open one' })
    const w = mount(NotesPanel, { props: { campaignId, target } })
    const markDone = w.findAll('button').find((b) => b.text() === 'mark done')
    await markDone!.trigger('click')
    expect(notes.byId(n.id)?.resolvedAt).not.toBeNull()
  })

  it('pin toggles the pinned flag', async () => {
    const notes = useNoteStore()
    const n = notes.create({ campaignId, target, body: 'a' })
    const w = mount(NotesPanel, { props: { campaignId, target } })
    const pinBtn = w.findAll('button').find((b) => b.text() === 'pin')
    await pinBtn!.trigger('click')
    expect(notes.byId(n.id)?.pinned).toBe(true)
  })

  it('edit replaces the row with the composer seeded from the note', async () => {
    const notes = useNoteStore()
    notes.create({ campaignId, target, body: 'old body' })
    const w = mount(NotesPanel, { props: { campaignId, target } })
    const editBtn = w.findAll('button').find((b) => b.text() === 'edit')
    await editBtn!.trigger('click')
    const ta = w.find('#note-body').element as HTMLTextAreaElement
    expect(ta.value).toBe('old body')
  })

  it('delete with confirm removes the note', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const notes = useNoteStore()
    const n = notes.create({ campaignId, target, body: 'kill me' })
    const w = mount(NotesPanel, { props: { campaignId, target } })
    const del = w.findAll('button').find((b) => b.text() === 'delete')
    await del!.trigger('click')
    expect(notes.byId(n.id)).toBe(null)
    confirmSpy.mockRestore()
  })

  it('respects hideWhenEmpty when there are no notes', () => {
    const w = mount(NotesPanel, {
      props: { campaignId, target, hideWhenEmpty: true },
    })
    expect(w.text()).not.toContain('Notes')
  })
})
