import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { asCampaignId } from '@core/ids/brand'

import { useTagStore } from '../store'

import TagPicker from './TagPicker.vue'

const camp = asCampaignId('camp_X')

describe('TagPicker', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    window.localStorage.clear()
  })

  it('shows the no tags yet hint when nothing is attached', () => {
    const w = mount(TagPicker, {
      props: { campaignId: camp, kind: 'character', targetId: 'char_1' },
    })
    expect(w.text()).toContain('no tags yet')
  })

  it('creates a tag and attaches it via the form', async () => {
    const w = mount(TagPicker, {
      props: { campaignId: camp, kind: 'character', targetId: 'char_1' },
    })
    const input = w.find('input')
    await input.setValue('Iron Banner')
    await w.find('form').trigger('submit.prevent')
    const store = useTagStore()
    expect(store.forTarget(camp, 'character', 'char_1').map((t) => t.slug)).toEqual(['iron-banner'])
    expect(w.text()).toContain('Iron Banner')
  })

  it('lists existing tags so they can be picked', async () => {
    const store = useTagStore()
    store.create({ campaignId: camp, name: 'Iron Banner' })
    const w = mount(TagPicker, {
      props: { campaignId: camp, kind: 'character', targetId: 'char_1' },
    })
    expect(w.text()).toContain('existing')
    const chip = w.findAll('span.inline-flex').find((s) => s.text().includes('Iron Banner'))
    expect(chip).toBeTruthy()
    await chip!.trigger('click')
    expect(store.forTarget(camp, 'character', 'char_1')).toHaveLength(1)
  })

  it('detaches via the remove button', async () => {
    const store = useTagStore()
    const tag = store.create({ campaignId: camp, name: 'Iron Banner' })
    store.attach(tag.id, 'character', 'char_1')
    const w = mount(TagPicker, {
      props: { campaignId: camp, kind: 'character', targetId: 'char_1' },
    })
    const removeBtn = w.findAll('button').find((b) => b.text() === '×')
    expect(removeBtn).toBeTruthy()
    await removeBtn!.trigger('click')
    expect(store.forTarget(camp, 'character', 'char_1')).toEqual([])
  })

  it('disables the add button when the input matches an existing slug', async () => {
    const store = useTagStore()
    store.create({ campaignId: camp, name: 'Iron Banner' })
    const w = mount(TagPicker, {
      props: { campaignId: camp, kind: 'character', targetId: 'char_1' },
    })
    await w.find('input').setValue('iron banner')
    const submit = w.findAll('button').find((b) => b.text() === 'add')
    expect(submit!.attributes('disabled')).toBeDefined()
  })
})
