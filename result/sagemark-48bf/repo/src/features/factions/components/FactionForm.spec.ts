import { mount, flushPromises } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import { asCampaignId } from '@core/ids'

import FactionForm from './FactionForm.vue'

const camp = asCampaignId('camp_TEST123456')

describe('FactionForm', () => {
  it('renders with defaults', () => {
    const w = mount(FactionForm, { props: { campaignId: camp } })
    expect((w.get('#faction-name').element as HTMLInputElement).value).toBe('')
    expect((w.get('#faction-alignment').element as HTMLSelectElement).value).toBe('unknown')
  })

  it('seeds from initial', () => {
    const w = mount(FactionForm, {
      props: {
        campaignId: camp,
        initial: { campaignId: camp, name: 'Iron Hand', motto: 'For order', alignment: 'good', influence: 70 },
      },
    })
    expect((w.get('#faction-name').element as HTMLInputElement).value).toBe('Iron Hand')
    expect((w.get('#faction-motto').element as HTMLInputElement).value).toBe('For order')
    expect((w.get('#faction-alignment').element as HTMLSelectElement).value).toBe('good')
  })

  it('emits submit with valid input', async () => {
    const w = mount(FactionForm, { props: { campaignId: camp } })
    await w.get('#faction-name').setValue('Order')
    await w.find('form').trigger('submit.prevent')
    const events = w.emitted('submit')
    expect(events).toHaveLength(1)
    expect(events?.[0]?.[0]).toMatchObject({ name: 'Order', campaignId: camp })
  })

  it('refuses an empty name', async () => {
    const w = mount(FactionForm, { props: { campaignId: camp } })
    await w.find('form').trigger('submit.prevent')
    await flushPromises()
    expect(w.emitted('submit')).toBeUndefined()
    expect(w.text().toLowerCase()).toContain('required')
  })

  it('cancel emits', async () => {
    const w = mount(FactionForm, { props: { campaignId: camp } })
    const cancel = w.findAll('button').find((b) => b.text() === 'Cancel')
    await cancel!.trigger('click')
    expect(w.emitted('cancel')).toHaveLength(1)
  })

  it('shows current influence value next to label', () => {
    const w = mount(FactionForm, {
      props: { campaignId: camp, initial: { campaignId: camp, name: 'x', influence: 65 } },
    })
    expect(w.text()).toContain('Influence (65)')
  })
})
