import { mount, flushPromises } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import { asCampaignId } from '@core/ids'

import ArcForm from './ArcForm.vue'

const camp = asCampaignId('camp_TEST123456')

describe('ArcForm', () => {
  it('renders default fields', () => {
    const w = mount(ArcForm, { props: { campaignId: camp } })
    expect(w.find('#arc-title').exists()).toBe(true)
    expect(w.find('#arc-tension').exists()).toBe(true)
  })

  it('seeds from initial', () => {
    const w = mount(ArcForm, {
      props: { campaignId: camp, initial: { campaignId: camp, title: 'Winter', status: 'active' } },
    })
    expect((w.get('#arc-title').element as HTMLInputElement).value).toBe('Winter')
    expect((w.get('#arc-status').element as HTMLSelectElement).value).toBe('active')
  })

  it('emits on valid submit', async () => {
    const w = mount(ArcForm, { props: { campaignId: camp } })
    await w.get('#arc-title').setValue('X')
    await w.find('form').trigger('submit.prevent')
    expect(w.emitted('submit')).toHaveLength(1)
  })

  it('rejects empty title', async () => {
    const w = mount(ArcForm, { props: { campaignId: camp } })
    await w.find('form').trigger('submit.prevent')
    await flushPromises()
    expect(w.emitted('submit')).toBeUndefined()
  })

  it('emits cancel', async () => {
    const w = mount(ArcForm, { props: { campaignId: camp } })
    const cancel = w.findAll('button').find((b) => b.text() === 'Cancel')
    await cancel!.trigger('click')
    expect(w.emitted('cancel')).toHaveLength(1)
  })
})
