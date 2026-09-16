import { mount, flushPromises } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import { asCampaignId } from '@core/ids'

import SessionForm from './SessionForm.vue'

const camp = asCampaignId('camp_TEST123456')

describe('SessionForm', () => {
  it('renders title and duration fields', () => {
    const w = mount(SessionForm, { props: { campaignId: camp } })
    expect(w.find('#session-title').exists()).toBe(true)
    expect(w.find('#session-duration').exists()).toBe(true)
    expect((w.get('#session-duration').element as HTMLInputElement).value).toBe('180')
  })

  it('seeds title from initial', () => {
    const w = mount(SessionForm, {
      props: { campaignId: camp, initial: { campaignId: camp, title: 'Old', playedAt: '2025-04-01T20:00:00Z' } },
    })
    expect((w.get('#session-title').element as HTMLInputElement).value).toBe('Old')
  })

  it('emits submit with parsed values', async () => {
    const w = mount(SessionForm, { props: { campaignId: camp } })
    await w.get('#session-title').setValue('Frostbite')
    await w.find('form').trigger('submit.prevent')
    const events = w.emitted('submit')
    expect(events).toHaveLength(1)
    expect(events?.[0]?.[0]).toMatchObject({ title: 'Frostbite', campaignId: camp })
  })

  it('rejects empty title', async () => {
    const w = mount(SessionForm, { props: { campaignId: camp } })
    await w.find('form').trigger('submit.prevent')
    await flushPromises()
    expect(w.emitted('submit')).toBeUndefined()
  })

  it('emits cancel', async () => {
    const w = mount(SessionForm, { props: { campaignId: camp } })
    const cancel = w.findAll('button').find((b) => b.text() === 'Cancel')
    await cancel!.trigger('click')
    expect(w.emitted('cancel')).toHaveLength(1)
  })
})
