import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { asCampaignId, asSessionId } from '@core/ids/brand'

import { usePrepStore } from '../store'

import PrepChecklistPanel from './PrepChecklistPanel.vue'

const camp = asCampaignId('camp_X')
const sess = asSessionId('sess_X')

describe('PrepChecklistPanel', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    window.localStorage.clear()
  })

  it('shows the empty hint when no items are prepped', () => {
    const w = mount(PrepChecklistPanel, { props: { campaignId: camp, sessionId: sess } })
    expect(w.text()).toContain('Nothing prepped yet')
  })

  it('add template fills with the default seed items', async () => {
    const w = mount(PrepChecklistPanel, { props: { campaignId: camp, sessionId: sess } })
    const btn = w.findAll('button').find((b) => b.text() === 'add template')
    await btn!.trigger('click')
    expect(usePrepStore().checklist(camp, sess).items.length).toBeGreaterThan(0)
    expect(w.text()).toContain('opening scene')
  })

  it('add form pushes a custom item', async () => {
    const w = mount(PrepChecklistPanel, { props: { campaignId: camp, sessionId: sess } })
    await w.find('input[type="text"]').setValue('queue music for the duel')
    await w.find('form').trigger('submit.prevent')
    expect(w.text()).toContain('queue music for the duel')
  })

  it('checkbox toggles the done state', async () => {
    const store = usePrepStore()
    const item = store.addItem(camp, sess, 'scene', 'open with a question')
    const w = mount(PrepChecklistPanel, { props: { campaignId: camp, sessionId: sess } })
    const cb = w.find('input[type="checkbox"]')
    await cb.trigger('change')
    expect(store.checklist(camp, sess).items.find((i) => i.id === item.id)!.done).toBe(true)
  })

  it('remove button drops the item', async () => {
    const store = usePrepStore()
    store.addItem(camp, sess, 'scene', 'open with a question')
    const w = mount(PrepChecklistPanel, { props: { campaignId: camp, sessionId: sess } })
    const removeBtn = w.findAll('button').find((b) => b.text() === 'remove')
    await removeBtn!.trigger('click')
    expect(store.checklist(camp, sess).items).toEqual([])
  })

  it('shows the progress badge with done over total', async () => {
    const store = usePrepStore()
    const a = store.addItem(camp, sess, 'scene', 'a')
    store.addItem(camp, sess, 'scene', 'b')
    store.toggleItem(camp, sess, a.id)
    const w = mount(PrepChecklistPanel, { props: { campaignId: camp, sessionId: sess } })
    expect(w.text()).toContain('1 / 2')
  })
})
